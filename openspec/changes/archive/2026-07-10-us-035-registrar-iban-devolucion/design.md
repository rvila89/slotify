# Design — us-035-registrar-iban-devolucion

## Context

US-035 (UC-26 FA-01, UC-27 pasos 1–3, actor **Gestor**) cierra el ciclo de recepción del IBAN
iniciado por E5 en US-034: el gestor registra manualmente el IBAN que el cliente le proporcionó, el
sistema lo valida (mod-97), lo persiste en `CLIENTE.iban_devolucion` y confirma la recepción al
cliente con el email **E8**. La infraestructura que necesita **ya existe y se reutiliza**:

- **US-034** (archivada) deja la RESERVA en `post_evento` y ya disparó E5 (solicitud de IBAN) si
  `fianza_eur > 0`. US-035 es el paso siguiente del mismo ciclo, sobre la misma precondición de
  estado + fianza.
- **US-045** (archivada) aportó el **motor de email reutilizable** de la capability `comunicaciones`:
  dado un trigger E1–E8, selecciona plantilla, sustituye variables de `RESERVA`/`CLIENTE`, envía por
  el **puerto de dominio de envío** (adaptador Resend en infra, modo fake en test/CI) y registra en
  `COMUNICACION` + `AUDIT_LOG`. `E8` ya pertenece al catálogo. US-035 **invoca** el motor con el
  trigger E8; no lo reimplementa. Es el patrón exacto ya aplicado por US-034 con E5.
- **`CLIENTE.iban_devolucion`** (`String?`, máx. 34) **ya existe** en el schema Prisma
  (`apps/api/prisma/schema.prisma`, model `Cliente`) y en `docs/data-model.md §CLIENTE`. **No hay
  migración de esquema** en US-035.
- `AuditLogPort` compartido con `usuarioId` **poblado** (acción de Usuario, no de Sistema). RLS por
  tenant vía el JWT del gestor.

Este documento fija las decisiones no triviales. Las decisiones de alcance que **requieren
aprobación en el gate humano** son **D-3** (política de idempotencia del reenvío de E8) y **D-4**
(verbo/ruta del endpoint de la acción del gestor, que materializa el `contract-engineer`).

## D-1. Dónde vive `iban_devolucion`: atributo de CLIENTE, no de RESERVA

- **Decisión**: el IBAN se persiste en **`CLIENTE.iban_devolucion`** (campo ya existente), **no** en
  la RESERVA. Es un dato del cliente que queda **disponible para futuras reservas del mismo cliente**
  (`US-035 §Reglas de negocio`, `§Reglas de Validación`).
- **Consecuencia observable**: si un cliente con IBAN ya registrado inicia una nueva reserva, el IBAN
  precargado se muestra; registrarlo de nuevo solo lo revalida/reenvía E8. El ámbito de la acción es
  **RESERVA** (la `COMUNICACION` E8 se liga a la reserva concreta de post-evento y a su `cliente_id`),
  pero el efecto persistido recae en **CLIENTE**.
- **Auditoría**: la entidad auditada es **`CLIENTE`** (`entidad = 'CLIENTE'`), no RESERVA — coherente
  con que el campo mutado pertenece al cliente. `datos_anteriores`/`datos_nuevos` capturan el IBAN
  previo (o `null`) y el nuevo.

## D-2. Guardar-luego-enviar: el guardado del IBAN y el envío de E8 son operaciones separadas

- **Problema**: FA-03 exige que un fallo del proveedor de email **no** revierta el IBAN ya guardado.
- **Decisión**: patrón **"persistir dentro de transacción, disparar E8 después del commit"**, simétrico
  al patrón de E5 en US-034 y de E2/E6/E7 en US-045:
  1. **Transacción**: validar mod-97 (pre-escritura) → `UPDATE CLIENTE SET iban_devolucion` →
     `INSERT AUDIT_LOG` (actualización del IBAN). Commit.
  2. **Post-commit**: invocar el motor de `comunicaciones` con el trigger **E8**. El motor crea la
     `COMUNICACION` (`enviado` si el proveedor acepta; `fallido` si falla) y su `AUDIT_LOG` de envío.
- **Consecuencia**: si E8 falla, el IBAN persiste (paso 1 ya commiteó), `COMUNICACION.estado = fallido`,
  y el gestor reintenta desde la ficha (mecanismo de reintento del motor de US-045). El envío **no**
  se hace dentro de la transacción de escritura del IBAN → un fallo de red no arrastra rollback.
- **Distinción con E4 (US-028)**: E4 es un envío **síncrono cuya atomicidad condiciona la emisión**
  (fallo ⇒ rollback). E8 es lo contrario, como E5: **el efecto persiste aunque el email falle**. Se
  documenta explícitamente para no confundir los dos patrones opuestos de la capability.

## D-3. Idempotencia vs. reenvío de E8 en corrección del IBAN (DECISIÓN DE GATE)

- **Tensión**: US-045 impone idempotencia `(reserva_id, codigo_email)` con **índice UNIQUE parcial**
  para que un disparo automático no duplique la `COMUNICACION`. Pero FA-02 exige que **cada corrección
  del IBAN reenvíe E8** — potencialmente varias E8 para la misma `(reserva_id, 'E8')`.
- **Precedente**: US-028 ya resolvió esta tensión para E4 con la excepción "Reenvío de E4 crea una
  nueva comunicación": un reenvío **manual e intencionado** del gestor es una excepción explícita y
  auditada a la idempotencia (que solo protege contra **disparos automáticos** duplicados).
- **Opciones para el gate**:
  - **(A) Nueva fila por reenvío** (recomendada): cada registro/corrección de IBAN válido inserta una
    **nueva** `COMUNICACION` E8. Requiere que el reenvío de E8 quede **fuera** del alcance del índice
    UNIQUE parcial (igual que el reenvío de E4). Máxima trazabilidad de cada confirmación enviada.
  - **(B) Upsert + contador de reenvíos**: una sola fila E8 por `(reserva_id, 'E8')` con un contador
    `reenvios` y `fecha_ultimo_envio`. Menos filas, pero pierde el detalle temporal de cada envío y
    complica el modelo.
- **Recomendación**: **(A)**, por consistencia con el precedente de E4 (US-028) y porque cada E8 es una
  confirmación al cliente con un IBAN potencialmente distinto (referencia distinta). **A confirmar en
  el gate humano.**

## D-4. Validación IBAN por checksum módulo 97 (regla de dominio pura)

- **Ubicación**: la validación vive en el **dominio** (`apps/api/src/.../domain/`), como **función
  pura** (arrow function, sin infra), no en el controller ni en infraestructura. El hook
  `no-infra-in-domain` no aplica porque no importa framework.
- **Algoritmo mod-97** (ISO 13616): (1) normalizar (mayúsculas, sin espacios); (2) validar prefijo de
  país de 2 letras + 2 dígitos de control + BBAN; (3) validar **longitud por país** (p. ej. ES = 24);
  (4) mover los 4 primeros caracteres al final; (5) convertir letras a números (A=10…Z=35); (6)
  calcular `mod 97`; el IBAN es válido si el resto es **1**.
- **Precede a toda escritura** (FA-01): la validación se ejecuta **antes** de abrir la transacción de
  UPDATE; un IBAN inválido devuelve `422` sin tocar BD ni disparar E8.
- **TDD primero**: la máquina de casos de validación (IBAN válido ES, longitud incorrecta, dígitos de
  control incorrectos, país desconocido, caracteres no alfanuméricos, string vacío, con espacios que
  se normalizan) se cubre con tests **antes** de la implementación. Es el núcleo verificable de US-035
  (no hay concurrencia crítica; el foco TDD es la validación + la orquestación guardar↔E8).
- **Reutilización**: si ya existe una utilidad de validación IBAN en el repo, se reutiliza; si no, se
  crea en dominio. El `contract-engineer`/`backend-developer` lo confirman en implementación. **En MVP
  solo validación de formato/checksum**; verificación bancaria en tiempo real está fuera de alcance
  (📐).

## D-5. Endpoint de la acción del gestor (DECISIÓN DE GATE — la materializa contract-engineer)

- La acción es **manual del gestor** (JWT de usuario, **no** `X-Cron-Token`). Opera sobre una RESERVA
  concreta en `post_evento` con `fianza_eur > 0`; el efecto recae en `CLIENTE.iban_devolucion` + E8.
- **Opciones de superficie** (a fijar tras el gate por el `contract-engineer`):
  - **(A)** `PATCH /reservas/{id}/iban-devolucion` con body `{ iban }` — acción contextualizada en la
    reserva de post-evento (recomendada: la `COMUNICACION` E8 se liga naturalmente a `reserva_id`, y
    la precondición `estado + fianza` se valida sobre esa reserva).
  - **(B)** `PATCH /clientes/{id}` con `iban_devolucion` — refleja que el dato es del cliente, pero
    pierde el contexto de reserva necesario para E8 y la precondición de post-evento/fianza.
  - **(C)** endpoint de reenvío separado `POST /reservas/{id}/comunicaciones/e8/reenviar` para FA-03
    (reintento tras fallo), o reutilizar el mecanismo de reintento genérico del motor de US-045.
- **Recomendación**: **(A)** para el registro + reutilizar el **reintento del motor de `comunicaciones`**
  para FA-03 (no inventar un endpoint de reenvío nuevo si el motor ya lo ofrece). Respuestas: `200/204`
  éxito (E8 enviado); `200` con aviso si IBAN guardado pero E8 fallido (FA-03); `422` IBAN inválido
  (FA-01); `409` conflicto de estado / sin fianza (FA-04). **A confirmar en el gate y el contrato.**
- El cliente HTTP del frontend se **regenera** desde el contrato (nunca a mano; hook
  `protect-generated-client`).

## D-6. Frontend: campo IBAN condicionado en la ficha de post-evento

- El campo IBAN se muestra/habilita **solo si `RESERVA.fianza_eur > 0`** (FA-04); en la feature de
  post-evento de `apps/web` (estructura Bulletproof por dominio, `features/<dominio>/`).
- **Responsive obligatorio** (regla dura): mobile-first, sin overflow horizontal, objetivos táctiles
  accesibles, verificado en 390/768/1280 en QA (Playwright).
- **Validación de formato en cliente** para UX inmediata (mismo mod-97), pero el **backend revalida**
  (no confía en la UI). Muestra el error de FA-01, la alerta de FA-03 (IBAN guardado + E8 fallido con
  botón de reenvío) y precarga el IBAN existente en correcciones (FA-02).
- Por haber cambios de frontend, **aplica el E2E con Playwright MCP** (`step-N+3`).

## D-7. Fuera de alcance (recordatorio)

Recordatorios automáticos A23/A24 (📐), portal de cliente para aportar IBAN (📐), validación bancaria
en tiempo real (📐) y la **ejecución de la devolución de la fianza** (US-036) quedan **fuera** de
US-035. US-035 solo registra el IBAN y confirma su recepción (E8).
