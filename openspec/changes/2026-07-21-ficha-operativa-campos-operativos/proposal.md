# Change: ficha-operativa-campos-operativos

> Ajuste de campos en la **Ficha operativa** de una consulta confirmada.
> Afecta al **contrato OpenAPI**, al **backend NestJS/Prisma** y al **frontend**.
> Elimina campos de texto libre (`menu_seleccionado`, `timing_detallado`) y los
> sustituye por campos estructurados (`hora_llegada`, `duracion`), y añade el
> correo del contacto de evento (`contacto_evento_correo`) como nuevo campo
> pre-rellenado desde los datos de la reserva.

## Why

La ficha operativa de una consulta confirmada dispone actualmente de dos campos de
texto libre (`menu_seleccionado`, `timing_detallado`) que en la práctica no se
usan con consistencia: se usan para anotar cosas dispares y no aportan información
estructurada accionable. Por otro lado, dos datos clave para la gestión del evento
— la hora de llegada y la duración — no tienen campo propio y quedan enterrados en
el campo libre de `timing_detallado`.

Adicionalmente, el correo del contacto del evento no figura en la ficha aunque ya
se dispone de ese dato en los datos del cliente/lead de la reserva: el equipo tiene
que buscarlo a mano cada vez.

Los campos de contacto (nombre, teléfono) ya se muestran en la ficha, pero el
correo no. Dado que el backend puede sembrarlo al crear la ficha desde los datos
de la reserva, es un dato que puede aparecer pre-rellenado sin trabajo extra del
Gestor.

## What Changes

### Campos eliminados del contrato y la lógica de negocio
- `menu_seleccionado` (string, texto libre) — eliminado de `FichaOperativa` y de
  `GuardarFichaOperativaRequest`. Las columnas de BD se mantienen como nullable
  (no se hace DROP) para preservar datos históricos.
- `timing_detallado` (string, texto libre) — ídem.

### Campos añadidos
- `contacto_evento_correo` (string, nullable) — correo del contacto del evento.
  Pre-relleno desde `reserva.contacto_email` (o el campo equivalente del modelo
  `Reserva`) cuando el backend crea la `FICHA_OPERATIVA` al confirmar la reserva.
  Editable por el Gestor como el resto de campos de contacto.
- `hora_llegada` (string, nullable) — hora de llegada al evento, formato `"HH:MM"`.
  Campo nuevo, sin valor por defecto; el Gestor lo rellena.
- `duracion` (string, nullable) — duración del evento, texto libre estructurado
  (ej: `"3h"`, `"2h 30min"`). Campo nuevo, sin valor por defecto.

### Frontend
- Sección de contacto: añadir campo correo junto a nombre y teléfono, todos
  pre-rellenados desde la ficha (igual que el resto).
- Eliminar del formulario los campos `menuSeleccionado` y `timingDetallado`.
- Añadir bloque "Logística del evento" con los campos `horaLlegada` y `duracion`.

## Impact

- **Ámbito:** contrato OpenAPI, backend NestJS/Prisma, frontend React.
- **Specs afectadas:** `openspec/specs/ficha-operativa/spec.md` (campos de lectura
  y escritura, pre-relleno de correo).
- **Columnas DB:** se añaden `contacto_evento_correo`, `hora_llegada`, `duracion`
  vía migración Prisma. Las columnas `menu_seleccionado` y `timing_detallado`
  permanecen en la BD como nullable pero se retiran del contrato y la lógica.
- **SDK frontend:** debe regenerarse tras actualizar `api-spec.yml`.
- **Riesgo:** medio — requiere migración de BD y regeneración de SDK. La eliminación
  de campos del contrato es un breaking change controlado (no hay consumidores
  externos del API).
- **Verificación:** `pnpm test` verde en `apps/api` y `apps/web`; migración Prisma
  sin errores; ficha muestra correo pre-rellenado; campos menu/timing desaparecen;
  horaLlegada y duracion se guardan y persisten.
