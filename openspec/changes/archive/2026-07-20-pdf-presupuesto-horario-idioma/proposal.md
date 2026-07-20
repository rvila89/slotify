# Change: pdf-presupuesto-horario-idioma

## Why

El uso real del **PDF de presupuesto** ("Pressupost", épico #6, generado con
`@react-pdf/renderer` en `apps/api`, dominio `documentos` + infra `presupuestos`)
ha revelado tres carencias que restan legibilidad y profesionalidad al documento
que recibe el cliente. Se agrupan en un único change por compartir superficie (la
capa de plantilla de `documentos` + la carga de datos del presupuesto) y por ser
cambios acotados de bajo acoplamiento entre sí. Las tres mejoras están **validadas
con el usuario**:

1. **El bloque de concepto es críptico en cuanto a horario.** Hoy la tabla de
   concepto muestra la fecha del evento en `dd/mm/aaaa`, una línea `(N hores)` y
   `N persones`. No dice a qué hora empieza ni acaba el evento, dato clave del
   contrato. Debe pasar a tres líneas legibles: la fecha del evento como
   "D de <mes> de AAAA" (con año, mes en el idioma del cliente), el rango horario
   "De HH:MM a HH:MM (N hores)" y el nº de personas. (Fuente: requisito del
   usuario; spec viva `presupuestos` "Contenido del PDF de presupuesto tomado de
   la config del tenant"; `documentos` `construirModeloDocumentoPresupuesto`;
   `design.md` N5.)

2. **El título "PRESSUPOST" se confunde con el resto del branding turquesa.** El
   título grande usa `branding.colorPrimario` (turquesa `#5edada`), el mismo color
   que la barra de la tabla de concepto, y pierde jerarquía visual. Debe pintarse
   en **amarillo** (`COLOR_ACENTO = #ffd978`, el mismo amarillo de la línea de
   condicions), y **solo en el presupuesto**: la FACTURA conserva su título
   turquesa. (Fuente: requisito del usuario; `estilos.ts §COLOR_ACENTO`; spec viva
   `documentos` "Fidelidad visual de la plantilla de documentos".)

3. **El PDF está 100% en catalán, ignorando el idioma del cliente.** Cada RESERVA
   tiene `idioma ∈ {'es','ca'}` (default `'es'`) y los correos ya se envían en ese
   idioma, pero el presupuesto siempre sale en catalán. Un cliente castellanoparlante
   recibe un documento en un idioma que no eligió. El PDF debe generarse en el
   idioma del cliente: **etiquetas fijas** del layout traducidas en código y
   **textos libres del tenant** (concepto fiscal, validesa, pie legal, condicions)
   bilingües es+ca, elegidos por `reserva.idioma`. (Fuente: requisito del usuario;
   `Reserva.idioma`; paridad con las plantillas de email traducidas en código.)

### Fuera de alcance (decisión de producto)

- **UI de ajustes para los textos libres del tenant.** Los textos bilingües
  (concepto fiscal, validesa, pie legal, condicions) se gestionan vía
  **SEED/MIGRACIÓN**, igual que las plantillas de email (que se traducen en
  código). No se añade pantalla de configuración ni endpoint para editarlos.
- **Contrato OpenAPI / SDK.** No hay superficie de API nueva: el PDF es interno y
  se genera post-commit. No se toca `docs/api-spec.yml` ni el cliente generado.
- **Persistir la hora de fin del evento.** `horaFin` se **calcula en memoria** a
  partir de `horario` + `duracionHoras` en el momento de construir el modelo; NO
  se persiste ninguna columna nueva de hora de fin.
- **La FACTURA no cambia de idioma en este change.** El alcance del idioma es el
  documento de PRESUPUESTO. (La factura reutiliza `BloqueTitulo` pero conserva
  color turquesa y su idioma actual; su i18n es trabajo futuro.)
- **El documento de "Condicions particulars" (6.4a) como PDF independiente** no
  entra en este change salvo por la estructura bilingüe del bloque `condiciones`
  en el VO/persistencia (para que el presupuesto elija el idioma). Su render
  bilingüe autónomo, si procede, es trabajo futuro.
- No cambia la máquina de estados, el bloqueo atómico de fecha, la numeración, el
  cálculo de tarifa ni el desglose fiscal por régimen.

## What Changes

### Mejora 1 — Horario y fecha legible en el bloque de concepto (capability `documentos`) · Backend puro + presentación
- `DatosDocumentoPresupuesto` gana `idioma: 'es' | 'ca'` y `horario: string | null`
  (hora de inicio "HH:MM", nullable).
- `construirModeloDocumentoPresupuesto` resuelve en el **modelo de vista** (donde
  recaen las aserciones de contenido) tres campos legibles:
  - **Fecha del evento**: "D de <mes> de AAAA" (con año), mes en el idioma del
    cliente (helper puro de meses es/ca, sin `Intl` dependiente de locale del
    entorno para ser determinista y testeable).
  - **Horario**: "De HH:MM a HH:MM (N <hores|horas>)". La hora de fin se calcula
    en memoria `horaFin = (inicioMin + duracionHoras*60) mod 1440`, reformateada a
    "HH:MM". Formato SIEMPRE con minutos.
  - **Fallback**: si `horario` es `null`, se muestra solo "(N <hores|horas>)" sin
    rango (comportamiento actual), sin romper.
- Los componentes react-pdf (`TablaConcepto`) solo pintan strings del modelo: las
  tres líneas (fecha / horario / personas).
- El adaptador `cargar-datos-documento-presupuesto.prisma.adapter.ts` proyecta
  `reserva.idioma` y `reserva.horario` en `DatosDocumentoPresupuesto`. Además, fix
  de deuda conocida: `numPersonas` se deriva
  `numInvitadosFinal ?? (numAdultosNinosMayores4 + numNinosMenores4)` en vez de
  solo `numAdultosNinosMayores4`.

### Mejora 2 — Título "PRESSUPOST" en amarillo, solo en el presupuesto (capability `documentos`) · Presentación
- El `DocumentoLayout` del **presupuesto** pinta el `BloqueTitulo` con el color de
  acento amarillo (`COLOR_ACENTO = #ffd978`, constante de presentación), no con
  `branding.colorPrimario`.
- El `DocumentoFacturaLayout` (que reutiliza `BloqueTitulo`) **no cambia**:
  conserva `colorPrimario` (turquesa). El cambio se acota al layout del presupuesto
  (color pasado como prop desde el layout), sin alterar el contrato de
  `BloqueTitulo` ni el modelo de vista.

### Mejora 3 — Idioma del PDF según el idioma del cliente es/ca (capabilities `documentos`, `presupuestos`) · Backend + presentación + seed/migración
- **Etiquetas fijas** del layout se traducen en el modelo de vista según
  `datos.idioma`: PRESSUPOST/PRESUPUESTO, Pressupost/Presupuesto, Data/Fecha,
  Dades client/Datos del cliente, CONCEPTE/CONCEPTO, PREU/PRECIO,
  persones/personas, hores/horas, Validesa/Validez, Base imposable/Base imponible,
  % Iva, Total, Condicions/Condiciones, Pagament anticipat/Pago anticipado,
  Fiança/Fianza, y los **nombres de mes**. Se resuelven en el builder puro (o
  helpers puros de i18n de `documentos/presentation`), no dispersas por los `.tsx`.
- **Textos libres del tenant** pasan a **bilingües** `{ ca, es }`:
  - El VO `TextosDocumento` cambia `plantillaConceptoFiscal`, `validesaTexto`,
    `pieLegal` a `{ ca: string; es: string }`.
  - El bloque `condiciones` (título y cada `{ titulo, cuerpo }`) pasa a `{ ca, es }`.
  - `construirModeloDocumentoPresupuesto` elige el texto por `datos.idioma` y sigue
    resolviendo `{nombreComercial}` (nunca "lloguer").
- **Persistencia**: migración Prisma no destructiva sobre `PlantillaDocumentoTenant`:
  desdoblar `plantilla_concepto_fiscal`, `validesa_texto`, `pie_legal` a columnas
  `_ca`/`_es`, y `condiciones` JSON a estructura con `ca`/`es`. **Backfill** `_ca` =
  valor catalán actual; `_es` = traducción del seed. La columna `condiciones`
  hereda la migración a estructura bilingüe.
- **Seed**: `configuracion-documento-piloto.ts` rellena `ca` (texto actual) + su
  traducción `es` para los cuatro textos libres. El factory sigue puro y
  determinista.
- El adaptador de configuración (`configuracion-documento.prisma.adapter.ts`) mapea
  las columnas bilingües al VO.

### Contrato
- **Sin cambios.** No hay superficie de API nueva; el PDF es interno.

## Impact

- **Specs afectadas**:
  - `specs/documentos/spec.md`
    - MODIFIED "Capa de plantilla de documentos react-pdf reutilizable" (el modelo
      de vista se parametriza también por idioma; etiquetas fijas traducidas en el
      builder).
    - MODIFIED "Fidelidad visual de la plantilla de documentos al diseño real del
      tenant" (título del **presupuesto** en amarillo `COLOR_ACENTO`; la factura
      conserva turquesa).
    - MODIFIED "Configuración de "Condicions particulars" por tenant" (bloque
      `condiciones` bilingüe `{ ca, es }`).
    - MODIFIED "Seed piloto del documento de "Condicions particulars"" (14
      secciones bilingües ca+es).
    - ADDED "Fecha y horario legibles del evento en el bloque de concepto".
    - ADDED "Idioma del documento de presupuesto según el idioma del cliente".
    - ADDED "Textos libres del tenant bilingües (es/ca) en la configuración de
      documento".
  - `specs/presupuestos/spec.md`
    - MODIFIED "Contenido del PDF de presupuesto tomado de la config del tenant"
      (concepto con fecha "D de mes de AAAA", rango horario "De HH:MM a HH:MM
      (N hores)" con fallback, nº de personas derivado del aforo, idioma del
      cliente).
- **Código afectado (tras el gate; no en este change)**:
  - `documentos`: `configuracion-documento.ts` (VO textos bilingües), i18n de
    etiquetas + helper de meses en `presentation`, `modelo-documento-presupuesto.ts`
    (idioma, fecha, horario, textos por idioma), `TablaConcepto.tsx` (tres líneas),
    `DocumentoLayout.tsx` (título amarillo), `configuracion-documento.prisma.adapter.ts`,
    seed `configuracion-documento-piloto.ts`.
  - `presupuestos`: `cargar-datos-documento-presupuesto.prisma.adapter.ts`
    (proyectar `idioma`, `horario`; fix `numPersonas`).
  - Prisma: migración aditiva bilingüe de `PlantillaDocumentoTenant` + backfill.
- **NO reimplementa**: bloqueo atómico de fecha, máquina de estados, numeración,
  motor de tarifa, desglose fiscal por régimen, contrato OpenAPI.
- **Guardrails**: `documentos` NO importa de `presupuestos` (hexagonal);
  multi-tenancy/RLS de `PlantillaDocumentoTenant` intacta (columnas nuevas heredan
  la policy 1-1 por tenant); arrow functions; `presentation/componentes/` solo
  `.tsx`.
- **Riesgo principal**: bajo/medio. El punto más sensible es la migración bilingüe
  con backfill (no destructiva) y el cálculo de `horaFin` cruzando medianoche
  (`mod 1440`) → TDD del builder puro primero.
