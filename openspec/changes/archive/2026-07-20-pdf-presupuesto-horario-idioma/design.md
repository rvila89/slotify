# Design — pdf-presupuesto-horario-idioma

> Decisiones técnicas del change. La spec (proposal + spec-delta) es la fuente de
> verdad del QUÉ; este documento fija el CÓMO donde no es trivial.

## Contexto

- Núcleo del contenido: builder **puro** `construirModeloDocumentoPresupuesto(config,
  datos)` en `apps/api/src/documentos/presentation/modelo-documento-presupuesto.ts`.
  Ahí recaen TODAS las aserciones de contenido; los componentes react-pdf solo
  pintan strings del modelo.
- Datos de la reserva ya presentes en el schema: `Reserva.idioma String @default("es")`,
  `Reserva.horario String? ("HH:MM")`, `Reserva.duracionHoras DuracionHoras? (4/8/12)`.
- El presupuesto y la factura comparten el componente `BloqueTitulo` (recibe
  `colorPrimario` como prop); `DocumentoLayout` (presupuesto) y
  `DocumentoFacturaLayout` (factura) lo componen por separado.

## D1 — Cálculo de la hora de fin (en memoria, `mod 1440`)

- `horaFin = (inicioMin + duracionHoras*60) mod 1440`, donde
  `inicioMin = HH*60 + MM` parseado de `Reserva.horario`. Se reformatea a "HH:MM"
  con cero-padding.
- **No se persiste** ninguna columna de hora de fin (fuera de alcance). Es un
  campo derivado del modelo de vista.
- **Cruce de medianoche**: el `mod 1440` cubre 22:00 + 4h → 02:00. TDD cubre este
  caso explícitamente.
- Helper puro en `documentos/presentation` (arrow function), testeable sin render.

## D2 — Idioma: dónde vive la traducción

- **Etiquetas fijas** (título, cabeceras de tabla, totales, condicions, nombres de
  mes): se resuelven en el **modelo de vista** (builder puro) o en **helpers puros
  de i18n** de `documentos/presentation` (p. ej. `etiquetas-por-idioma.ts`,
  `meses.ts`). **Nunca** dispersas en los `.tsx` (los componentes solo pintan).
- **No usar `Intl.DateTimeFormat`** para el nombre del mes: depende del locale
  instalado en el entorno y rompe el determinismo de los unit tests. Mapa estático
  `MESES = { ca: [...12], es: [...12] }`.
- **Default `'es'`**: `idioma` desconocido/ausente cae a castellano. Es coherente
  con `Reserva.idioma @default("es")`.
- El `idioma` es un dato del documento (`DatosDocumentoPresupuesto.idioma`), NO se
  importa de `presupuestos`: `documentos` sigue sin acoplarse (hexagonal), igual
  que hoy `RegimenDocumento` está duplicado intencionadamente en `documentos`.

## D3 — Textos libres bilingües: forma del VO y de la persistencia

- **VO** (`configuracion-documento.ts`): `TextosDocumento` pasa a
  `{ plantillaConceptoFiscal: {ca,es}; validesaTexto: {ca,es}; pieLegal: {ca,es} }`;
  `CondicionesDocumento` pasa a título y secciones `{ca,es}`.
- **Prisma** (`PlantillaDocumentoTenant`): migración **no destructiva**.
  - Columnas de texto: `plantilla_concepto_fiscal` → `_ca` + `_es`;
    `validesa_texto` → `_ca` + `_es`; `pie_legal` → `_ca` + `_es`.
  - Estrategia de migración: añadir las columnas `_ca`/`_es` (nullable en el paso
    intermedio), **backfill** `_ca = <columna actual>` y `_es = <traducción del
    seed>`, luego (opcional, en la misma migración) dejar `_ca`/`_es` NOT NULL y
    **eliminar** la columna monolingüe antigua. Al ser tabla de config 1-1 por
    tenant y sembrada, el riesgo es bajo; el reseed del piloto garantiza el `_es`.
  - `condiciones` JSON: se migra a la estructura bilingüe; el backfill mueve el
    contenido catalán actual a `ca` y el seed aporta `es`.
- **RLS**: `plantilla_documento_tenant` ya tiene la policy 1-1 por tenant; las
  columnas nuevas la heredan. **No se recrea** la policy.
- **Seed** (`configuracion-documento-piloto.ts`): factory puro que devuelve `ca`
  (texto catalán actual, ya en el fichero) + `es` (traducción). Determinista y
  testeable sin Postgres.

## D4 — Título amarillo acotado al presupuesto

- `DocumentoLayout` (presupuesto) pasa `COLOR_ACENTO` (`#ffd978`, ya definido en
  `estilos.ts`) como `colorPrimario`/color del título a `BloqueTitulo`.
- `DocumentoFacturaLayout` **no cambia**: sigue pasando `modelo.cabecera.colorPrimario`
  (turquesa).
- No se toca el contrato de `BloqueTitulo` ni el modelo de vista (el color de
  título es decisión del layout). Cambio de presentación puro: los tests de
  contenido del modelo quedan verdes.

## D5 — Adaptador de carga de datos

- `cargar-datos-documento-presupuesto.prisma.adapter.ts` proyecta:
  - `idioma`: `reserva.idioma === 'ca' ? 'ca' : 'es'` (normaliza al union `es|ca`).
  - `horario`: `reserva.horario` (string "HH:MM" | null).
  - `numPersonas`: `reserva.numInvitadosFinal ?? (reserva.numAdultosNinosMayores4
    + reserva.numNinosMenores4)` (fix de la deuda conocida; nulls tratados como 0
    de forma consistente con el resto del adaptador).
- Mantiene RLS (`fijarTenant` + filtro `tenantId`) y la degradación a `null` en
  cross-tenant / no encontrado.

## D6 — Alcance del idioma

- El idioma cubre el **documento de PRESUPUESTO** (etiquetas fijas + textos libres).
- La **factura** conserva su idioma actual en este change (su i18n es trabajo
  futuro), aunque el bloque `condiciones` bilingüe queda disponible para consumos
  futuros.

## Cuestiones para el gate humano — RESUELTAS

1. Traducción `es` de los cuatro textos libres del piloto (concepto fiscal, validesa,
   pie legal, 14 secciones de condicions): **la redacta el implementador en el seed**;
   el usuario la revisa en QA sobre el PDF real. (Gate 1)
2. La factura **NO cambia de idioma** en este change (D6): confirmado fuera de alcance.
   (Gate 1)
3. Estrategia de migración (D3): **eliminar la columna monolingüe antigua en la MISMA
   migración** (ADD `_ca`/`_es` nullable → backfill `_ca` = valor actual → seed fija
   `_es` → ALTER `_ca`/`_es` NOT NULL → DROP columna antigua). Tabla de config 1-1 por
   tenant y sembrada: riesgo bajo, esquema limpio. (Gate 1)
