# Change: email-transicion-fecha-borrador

## Why

El flujo de **transición de fecha** (`POST /reservas/:id/fecha`,
`apps/api/src/reservas/application/transicion-fecha.use-case.ts`, US-005) genera hoy
un correo al cliente que **no gusta y provocó una incidencia real**: cuando el gestor
asigna una fecha libre a una consulta exploratoria (`2.a → 2.b`), el sistema crea la
`COMUNICACION` E1 en `borrador` y **la auto-envía** post-commit
(`enviarConfirmacionTolerante`). El texto es un literal hardcodeado en castellano
(`ASUNTO_/CUERPO_CONFIRMACION_BLOQUEO` — *"Hemos reservado provisionalmente tu fecha"*),
seco y sin personalizar. Además, la rama de **cola** (`2.a → 2.d`, cuando el gestor
acepta la lista de espera) **no genera ningún correo**.

Se quiere:

1. **No auto-enviar**: el correo E1 queda en **`borrador`** para revisión del gestor y
   se envía con el flujo ya existente de **US-046** (`GET /reservas/:id/comunicaciones`
   → diálogo *"Revisar y enviar borrador"* → `POST .../enviar`). No se recrea ese flujo:
   ya está en `master`.
2. **Nueva redacción dinámica** en **dos plantillas** (fecha disponible / fecha
   bloqueada) con **nombre, fecha del evento, personas, horas e idioma** interpolados.
3. La rama **cola** (`2.d`) **también** genera su borrador (plantilla "fecha bloqueada");
   el caso no encolable (409 sin cola) sigue sin correo.

Es un **cambio de comportamiento con reglas de negocio** (borrador vs auto-envío, dos
plantillas nuevas, idioma dinámico), por lo que nace como change de OpenSpec y pasa por
los gates humanos del harness. (Fuente: US-005 §Email relacionado; US-046 flujo de
revisión/envío de borradores; plan aprobado `email-transicion-fecha-borrador`.)

## What Changes

> Slice **solo backend** sobre la capability `consultas` (donde vive US-005). **Sin
> cambios de contrato OpenAPI/SDK ni de frontend**: las formas de `POST /reservas/:id/fecha`,
> `GET .../comunicaciones` y `POST .../enviar` no cambian, y la UI de revisión/envío de
> borradores (US-046) ya existe. Sujeto al **Gate de revisión humana SDD**.

- **MODIFICA** el requisito de email de la transición (hoy *"Email de confirmación de
  bloqueo provisional vía el motor de US-045"*): en la rama libre (`2.a → 2.b`) el
  correo E1 se crea en `borrador` y **NO se auto-envía**; queda para revisión manual del
  gestor por el flujo de US-046. El fallo de envío deja de ser una preocupación de este
  flujo porque **ya no hay envío** aquí.
- **AÑADE** la generación de un borrador E1 en la rama **cola** (`2.a → 2.d` con
  `aceptarCola = true`) con la plantilla "fecha bloqueada". El caso **no encolable**
  (`AsignarFechaConflictoError` con `colaDisponible:false`) **sigue sin correo** y sin
  mutar la RESERVA.
- **AÑADE** las **dos plantillas de transición de fecha** ("disponible" / "cola") con
  interpolación de: `nombre` (nombre de pila del cliente, `Cliente.nombre`),
  `fechaEvento` (formateada en el idioma), `personas` (= `numInvitadosFinal`), `horas`
  (= `duracionHoras`) e `idioma` (`ca` → catalán; cualquier otro valor → castellano).
- **AÑADE** la regla de **placeholder visible `___`** cuando `personas` u `horas` son
  `null` (una consulta exploratoria puede no tenerlos aún); el gestor los completa al
  revisar el borrador antes de enviarlo.
- **Firma hardcodeada** *"Ari — Masia l'Encís"* (coherente con el catálogo E1/E3
  actual). Parametrizar por tenant/gestor es **deuda futura**, fuera de este change.

## Impact

- Specs: **modifica la capability `consultas`** — reemplaza el requisito de email de la
  transición por: (a) borrador sin auto-envío en la rama libre `2.b`; (b) borrador en la
  rama cola `2.d`; (c) las dos plantillas dinámicas con idioma/placeholder. No se toca
  ninguna otra capability.
- Contrato OpenAPI (`docs/api-spec.yml`) y SDK: **sin cambios**. El cuerpo del borrador
  ya viaja en el listado de `GET .../comunicaciones`.
- Frontend: **sin código nuevo**. El gestor revisa/envía con la UI de US-046. Se
  **verifica en QA** que la ficha de la consulta muestra la card de comunicaciones para
  `2b`/`2d`; si no, sería un ajuste menor evaluado en QA.
- Código (implementación posterior, fuera de este change de spec):
  `apps/api/src/reservas/application/transicion-fecha.use-case.ts` (rellenar
  asunto/cuerpo desde el nuevo render en ambas ramas; **eliminar el auto-envío**), nuevo
  módulo puro `apps/api/src/reservas/application/plantilla-transicion-fecha.ts`,
  `apps/api/src/reservas/infrastructure/transicion-fecha-uow.prisma.adapter.ts` (ampliar
  la proyección de lectura), y **limpieza de código muerto**
  (`ASUNTO_/CUERPO_CONFIRMACION_BLOQUEO`, `enviarConfirmacionTolerante`, el puerto
  `ConfirmacionBloqueoEmailPort` + `confirmacion-bloqueo-email.adapter.ts`, el dep
  `confirmacionBloqueo` y su wiring en `reservas.module.ts` / `reservas.tokens.ts`, el
  campo interno `emailPendiente`).
- **Migración**: **no**. Todas las columnas leídas (`Reserva.idioma`,
  `num_invitados_final`, `duracion_horas`, `Cliente.nombre`) ya existen en el schema.
- Trazabilidad: **US-005** (transición de fecha, email extensión de E1), **US-046**
  (revisión/envío de borradores), **UC-04**; entidades RESERVA, COMUNICACION, CLIENTE;
  catálogo §9.3 E1.
- Dependencias (todas en `master`): US-005 (transición), US-045 (motor email / catálogo
  de plantillas), US-046 (revisión y envío de borradores).

## Lo que NO entra (anti-scope)

- **Auto-respuesta E1 de ALTA de consulta** (dossier *"Hem rebut la teva consulta"*):
  **no se toca**. Este change es SOLO el flujo de transición de fecha.
- **Envío del correo**: sigue siendo manual por US-046; este change no cambia el
  endpoint `POST .../enviar` ni el motor de envío.
- **Parametrización de la firma por tenant/gestor**: deuda futura; la firma queda
  hardcodeada "Ari — Masia l'Encís".
- **Idiomas distintos de catalán/castellano**: `ca` → catalán, cualquier otro → castellano.
- **Contrato OpenAPI / SDK / frontend**: sin cambios de código.

## Decisiones de alcance (confirmadas con el usuario)

- **Alcance**: SOLO transición de fecha; el auto-respuesta E1 de alta no se toca.
- **Idiomas**: catalán y castellano, por `reserva.idioma` (`ca` → CA; resto → ES).
- **Fecha del "presupuesto"** del ejemplo (25/07) = la **misma `fechaEvento`**. El
  **"40%"** es texto fijo.
- **personas** = `numInvitadosFinal`; **horas** = `duracionHoras`; **placeholder `___`**
  si falta el dato.
- **Firma** hardcodeada "Ari — Masia l'Encís" (deuda: parametrizar por tenant).
