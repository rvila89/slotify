# Spec Delta — Capability `comunicaciones`

> Este change corrige el **formato del cuerpo al enviar**: el borde de envío convierte el
> **texto plano** (con saltos de línea/párrafos) a **HTML** (`<p>`/`<br>` con escape), de
> modo que el cliente de correo no colapse los saltos de línea. Aplica al E1 de transición y
> a los emails manuales (cuyo `cuerpo` es texto plano). El HTML ya renderizado por el
> catálogo (E1/E2/E3) NO se vuelve a convertir (evita doble-escape). Ver `design.md §D-2`.
> Fuente: US-045 §Confirmación de envío; US-046; `resend.email.adapter.ts`;
> `catalogo-plantillas.ts`.

## MODIFIED Requirements

### Requirement: Confirmación de envío de un borrador con edición opcional de asunto y cuerpo

El sistema SHALL (DEBE) permitir al gestor **confirmar el envío** de una
`COMUNICACION` en `estado = 'borrador'`: envía el email al `destinatario_email` de la
comunicación (heredado del `CLIENTE`) **reutilizando el camino de envío del motor de
US-045** (`EnviarEmailPort`), y al aceptar el proveedor actualiza la fila a
`estado = 'enviado'` con `fecha_envio` **no nulo**. El gestor PUEDE editar opcionalmente
`asunto` y `cuerpo` antes de confirmar; cuando lo hace, el `asunto`/`cuerpo`
**persistido** en `COMUNICACION` DEBE reflejar el contenido **efectivamente enviado**
(no la versión original del borrador). El gestor NO PUEDE modificar `codigo_email` ni
`destinatario_email`. **En el borde de envío**, cuando el `cuerpo` es **texto plano** (con
saltos de línea `\n`, como el E1 de transición o un email manual editado en el textarea de
revisión), el sistema DEBE **convertirlo a HTML preservando el formato**: escapar el HTML,
transformar los párrafos (`\n\n → <p>…</p>`) y los saltos de línea simples (`\n → <br>`), y
enviar ese HTML en `html` mientras `text` conserva el **texto crudo**. Un `cuerpo` que ya
es **HTML renderizado** (p. ej. el generado por el catálogo E1/E2/E3) NO DEBE volver a
convertirse (para no doble-escapar el marcado). La conversión NO altera el `cuerpo`
**persistido** en `COMUNICACION` (que sigue siendo el texto que el gestor ve/edita); solo
afecta al `html` que recibe el proveedor. La acción DEBE registrarse en `AUDIT_LOG` y
ejecutarse bajo el `tenant_id` del JWT. (Fuente: `US-046 §Happy Path — Revisar y enviar`,
`§Happy Path — Revisar, editar y enviar`, `§Reglas de Validación`; UC-36; plan aprobado del
usuario; `resend.email.adapter.ts`; `catalogo-plantillas.ts`; `design.md §D-2`.)

#### Scenario: Confirmar el envío sin editar deja la comunicación enviada

- **GIVEN** una `COMUNICACION` con `codigo_email = 'E1'`, `estado = 'borrador'`,
  vinculada a una RESERVA activa, con `destinatario_email` válido
- **WHEN** el gestor confirma el envío sin editar
- **THEN** el sistema envía el email al `destinatario_email` reutilizando el puerto de
  envío del motor
- **AND** actualiza la fila a `estado = 'enviado'` con `fecha_envio` no nulo
- **AND** registra la operación en `AUDIT_LOG`

#### Scenario: Editar el cuerpo persiste el contenido efectivamente enviado

- **GIVEN** una `COMUNICACION` en `estado = 'borrador'`
- **WHEN** el gestor modifica el `cuerpo` con texto personalizado y confirma el envío
- **THEN** el sistema envía el email con el `cuerpo` editado
- **AND** actualiza `estado = 'enviado'`, registra `fecha_envio` y el `cuerpo`
  almacenado en `COMUNICACION` refleja el contenido enviado (no el original)

#### Scenario: El gestor no puede modificar el código ni el destinatario

- **GIVEN** una `COMUNICACION` en `estado = 'borrador'`
- **WHEN** el gestor confirma el envío
- **THEN** el sistema mantiene `codigo_email` y `destinatario_email` originales
  (solo `asunto` y `cuerpo` son editables)

#### Scenario: El cuerpo en texto plano se envía como HTML preservando los saltos de línea

- **GIVEN** una `COMUNICACION` en `estado = 'borrador'` cuyo `cuerpo` es **texto plano** con
  varios párrafos separados por `\n\n` y saltos de línea simples `\n` (E1 de transición o
  email manual)
- **WHEN** el gestor confirma el envío
- **THEN** el `html` que recibe el proveedor contiene el cuerpo convertido con `<p>` por
  párrafo y `<br>` por salto simple, con el texto escapado
- **AND** el `text` que recibe el proveedor conserva el texto plano crudo
- **AND** el cuerpo persistido en `COMUNICACION` sigue siendo el texto plano (la conversión
  no lo altera)

#### Scenario: Un cuerpo que ya es HTML del catálogo no se doble-escapa al enviar

- **GIVEN** una `COMUNICACION` cuyo `cuerpo` ya es **HTML renderizado** por el catálogo
  (E1/E2/E3, con `<p>`/`<br>`)
- **WHEN** el sistema envía el email
- **THEN** el `html` que recibe el proveedor conserva el marcado del catálogo intacto (no se
  vuelve a escapar ni a envolver en `<p>`)
