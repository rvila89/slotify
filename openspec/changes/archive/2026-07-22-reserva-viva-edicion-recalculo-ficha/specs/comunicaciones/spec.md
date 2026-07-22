# Spec Delta — Capability `comunicaciones`

> **reserva-viva-edicion-recalculo-ficha** — El recálculo dentro de la ventana viva envía al
> cliente un email notificando la modificación de la reserva (cambio de nº de personas y/o de
> duración) y el nuevo restante a liquidar, en el IDIOMA de la reserva (`RESERVA.idioma`).
> Reutiliza el motor de email de US-045 y el patrón i18n del catálogo de plantillas (render por
> `codigoEmail` + idioma, fallback a `es`) de E2/E3; se añade una plantilla nueva coherente con
> las actuales.
>
> Fuente: petición de usuario; `US-045` motor de email reutilizable e i18n; `US-015` reenvío E2
> (`es_reenvio`); `catalogo-plantillas.ts` (`renderE2`/`renderE2Ca`, `renderE3`/`renderE3Ca`);
> `codigo-email.ts`; `er-diagram.md §COMUNICACION`; memoria del proyecto E2/E3 i18n.

## ADDED Requirements

### Requirement: Email de modificación de reserva en el idioma de la reserva

El sistema SHALL (DEBE), tras un recálculo del precio en la ventana viva que produce un nuevo
presupuesto de modificación, **enviar al cliente** una COMUNICACION que le notifique la
modificación solicitada (indicando si cambió el **nº de personas**, la **duración** o ambos) y
que se le envía un nuevo presupuesto con el **restante a liquidar** actualizado. El email SHALL
(DEBE) redactarse en el **idioma de la reserva** (`RESERVA.idioma`), reutilizando el motor de
email de US-045 y el patrón i18n del catálogo de plantillas (render indexado por `codigoEmail` +
idioma con **fallback a `es`** y registro en `AUDIT_LOG` cuando no exista variante para el
idioma), como ya hacen E2/E3. Se añade una **plantilla nueva** (código de email dedicado, con
variantes `es` y `ca`) coherente en tono y formato con las plantillas existentes; el adjunto es
el PDF del presupuesto de modificación (patrón E2). El envío es un efecto **post-commit**: su
fallo NO revierte el recálculo ya comprometido y queda trazado como COMUNICACION `fallido`
reintentable. Toda operación filtra por el `tenant_id` del JWT (RLS). (Fuente: petición de
usuario; `US-045` motor + i18n + fallback; `US-015` reenvío post-commit; `catalogo-plantillas.
ts`; `codigo-email.ts`.)

#### Scenario: Modificación con la reserva en catalán envía el email en catalán

- **GIVEN** una RESERVA con `idioma = 'ca'` recalculada por un aumento de invitados
- **WHEN** el sistema notifica la modificación al cliente
- **THEN** envía la COMUNICACION con la plantilla nueva en variante `ca`, indicando el cambio de
  nº de personas y el nuevo restante a liquidar, con el PDF del presupuesto de modificación
  adjunto

#### Scenario: Modificación con la reserva en español envía el email en español

- **GIVEN** una RESERVA con `idioma = 'es'` recalculada por un cambio de duración
- **WHEN** el sistema notifica la modificación al cliente
- **THEN** envía la COMUNICACION con la plantilla nueva en variante `es`, indicando el cambio de
  duración y el nuevo restante a liquidar

#### Scenario: Idioma sin variante cae a español con traza

- **GIVEN** una RESERVA con un `idioma` sin variante de plantilla disponible
- **WHEN** el sistema resuelve la plantilla del email de modificación
- **THEN** aplica el fallback a la variante `es` y registra la incidencia en `AUDIT_LOG` (mismo
  comportamiento que E1/E2/E3)

#### Scenario: Un fallo del proveedor no revierte el recálculo

- **GIVEN** un recálculo ya comprometido (importes re-congelados, presupuesto de modificación y
  liquidación regenerados)
- **WHEN** el envío del email de modificación falla en el proveedor
- **THEN** el recálculo NO se revierte y la COMUNICACION queda registrada como `fallido`
  (reintentable), sin afectar a la consistencia de la RESERVA
