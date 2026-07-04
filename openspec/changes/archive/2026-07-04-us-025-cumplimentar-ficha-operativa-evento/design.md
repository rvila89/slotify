# Design — us-025-cumplimentar-ficha-operativa-evento

> Decisiones técnicas no triviales de la cumplimentación y cierre de la FICHA_OPERATIVA y de
> las transiciones del sub-proceso `RESERVA.pre_evento_status`. Todas quedan **abiertas hasta
> el OK del Gate SDD**.
> Trazabilidad: US-025, UC-20, Módulo M7; `er-diagram.md §3.14 FICHA_OPERATIVA`,
> `§RESERVA pre_evento_status`; spec viva de `confirmacion` (US-021); `CLAUDE.md` (máquina de
> estados como estructura de datos, hexagonal/DDD, multi-tenancy/RLS, mobile-first).

## Contexto

US-021 dejó la RESERVA en `reserva_confirmada` con la FICHA_OPERATIVA vacía creada (1:1,
`reserva_id @unique`, campos de contenido `NULL`, `ficha_cerrada = false`) y los tres
sub-procesos inicializados, entre ellos `pre_evento_status = pendiente`. El modelo Prisma
`FichaOperativa` (schema.prisma L489–507) y el enum `PreEventoStatus`
(`pendiente | en_curso | cerrado`, L72–76, campo en RESERVA L280) **ya existen**. US-025
**no crea entidad ni enum**: añade el flujo de leer/guardar/cerrar/editar la ficha y las
transiciones de `pre_evento_status`. No hay migración prevista.

## D-1 — Máquina de estados de `pre_evento_status` como estructura de datos con guardas

**Decisión (recomendada): modelar las transiciones `pre_evento_status` (`pendiente → en_curso
→ cerrado`) como una estructura de datos de transiciones+guardas en dominio puro, siguiendo el
patrón del proyecto (`CLAUDE.md`: "las transiciones permitidas y sus guardas se modelan como
estructura de datos, no como código disperso").**

- Transiciones válidas:
  - `pendiente → en_curso`: guarda = primer guardado con al menos un campo con dato (ver D-2).
    Automática, sin acción explícita del Gestor.
  - `en_curso → cerrado`: guarda = acción "Cerrar ficha" del Gestor; no requiere ficha
    completa (ver D-6).
  - `cerrado → cerrado` (idempotente en edición): la edición de una ficha cerrada **no** cambia
    de estado (ver D-4); NO se modela `cerrado → en_curso` (la edición no reabre).
- El dominio de `ficha-operativa` es puro (no importa Prisma/NestJS); los puertos para leer
  reserva+ficha y persistir viven en dominio, los adaptadores en infraestructura (hexagonal).

**Alternativa descartada**: dispersar los `if` de estado en el use-case → incoherente con el
patrón del proyecto y frágil ante US-031/US-026.

## D-2 — Criterio de "primer guardado con datos" (disparo `pendiente → en_curso`)

**Decisión (recomendada): la transición se dispara cuando, tras aplicar el guardado, la ficha
queda con al menos un campo de contenido no nulo/no vacío (string vacío o solo espacios cuenta
como vacío; `num_invitados_confirmado` cuenta como dato si es un entero presente).**

- Se evalúa sobre el resultado del guardado (no solo sobre el payload) para cubrir guardados
  parciales sucesivos. Es idempotente: si ya está en `en_curso`/`cerrado`, no reevalúa.
- Un guardado que deja la ficha completamente vacía (o borra el único dato) **no** dispara la
  transición y no la revierte si ya estaba en `en_curso` (no hay `en_curso → pendiente`).

**A validar en el Gate**: si el negocio prefiere que **cualquier** POST de guardado (aunque
vacío) dispare `en_curso`, se ajusta la guarda; la US dice "al persistir los primeros datos".

## D-3 — Guarda de acceso por `RESERVA.estado` y respuesta ante estado anterior

**Decisión (recomendada): la guarda comprueba `RESERVA.estado ∈ {reserva_confirmada,
evento_en_curso, post_evento}` en el servidor antes de cualquier lectura/escritura, filtrando
por `tenant_id` del JWT (RLS). Ante un estado anterior a `reserva_confirmada`, la respuesta es
un cuerpo específico "no disponible aún" con el mensaje contextual, no un 500 ni un 404 opaco.**

- **A validar en el Gate (input al contrato)**: la forma exacta de exponerlo — recomendación:
  `409 Conflict` (o `404` con `code` semántico) con `code = 'ficha_no_disponible'` y el mensaje
  "La ficha operativa estará disponible una vez confirmada la reserva", para que el frontend
  distinga "no disponible por estado" de "no existe". El `contract-engineer` fija el status.
- RESERVA de otro tenant: no se expone (filtrado por `tenant_id`).

## D-4 — `fecha_cierre` en la edición post-cierre

**Decisión (recomendada): en cada guardado con la ficha ya `ficha_cerrada = true`, actualizar
`fecha_cierre = now()` y mantener `pre_evento_status = cerrado`.**

- Coincide literalmente con `US-025 §Edición de la ficha tras cerrarla` ("actualiza
  `fecha_cierre = now()`; `pre_evento_status` permanece `cerrado`"). `fecha_cierre` pasa a
  significar "última consolidación del cierre". La edición no reabre el estado.
- `fecha_actualizacion` (columna `@updatedAt`) se mueve en todo guardado por Prisma; es
  independiente de `fecha_cierre`.

## D-5 — Contrato: endpoints anidados de la ficha operativa (input a la fase de contrato)

**Decisión (recomendada, a fijar por el `contract-engineer` tras el Gate):** endpoints
anidados en el recurso reserva.

- `GET /reservas/{reservaId}/ficha-operativa` — leer la ficha (o el cuerpo "no disponible"
  si la reserva no está confirmada). Respuesta: campos de contenido, `ficha_cerrada`,
  `fecha_cierre`, `pre_evento_status`.
- `PATCH /reservas/{reservaId}/ficha-operativa` — guardar/actualizar campos (parcial). Efecto
  colateral: `pendiente → en_curso` si aplica (D-2). Sirve también para la edición post-cierre
  (D-4).
- `POST /reservas/{reservaId}/ficha-operativa/cerrar` — cerrar la ficha (`en_curso → cerrado`,
  `ficha_cerrada = true`, `fecha_cierre = now()`). Respuesta incluye el aviso informativo de
  campos vacíos (D-6), nunca como error.

Alternativa (a discutir en el Gate): `PUT` completo en lugar de `PATCH`, o exponer el aviso de
campos vacíos como un warning en el `GET`/`PATCH` en vez de solo en el cierre. No se toca
`docs/api-spec.yml` en este change de spec; es input para la fase de contrato.

## D-6 — Cierre no bloqueante: aviso informativo, no error

**Decisión (recomendada): el cierre nunca falla por campos vacíos. El use-case calcula la lista
de campos opcionales vacíos y la devuelve como `avisosCamposVacios` en la respuesta del cierre;
el frontend la muestra como aviso informativo (toast/inline), no como validación bloqueante.**

- Ningún 4xx por campos vacíos. El 4xx solo aplica a errores reales (reserva no accesible por
  estado/tenant, ficha no en `en_curso` al cerrar, etc.). El frontend mobile-first muestra el
  aviso y confirma el cierre.

## Multi-tenancy, auditoría y frontend

- **Multi-tenancy/RLS**: toda operación filtra por `tenant_id` del JWT; la ficha de otra tenant
  no es accesible (`CLAUDE.md`).
- **AUDIT_LOG**: se registra en cada guardado de campos, en la transición `pendiente →
  en_curso`, en el cierre (`en_curso → cerrado`) y en cada edición post-cierre. La acción/entidad
  exactas se alinean con el patrón vivo de AUDIT_LOG (US-003+) en implementación.
- **Frontend** (`apps/web/src/features/ficha-operativa/**`, Bulletproof React con barrel):
  formulario con los 7 campos, indicador de estado (`pendiente`/`en_curso`/`cerrado`), botón
  "Cerrar ficha" con confirmación y aviso de campos vacíos, fecha de cierre y edición
  post-cierre; mensaje contextual cuando la reserva no está confirmada. Mobile-first, verificado
  en 390/768/1280.
