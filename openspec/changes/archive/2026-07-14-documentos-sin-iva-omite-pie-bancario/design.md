# Design — documentos-sin-iva-omite-pie-bancario

Fix acotado, solo render backend. Sin BD, sin contrato/SDK, sin frontend. Una
sola decisión de diseño: dónde y cómo colgar el flag de visibilidad del pie
bancario, reutilizando el patrón de la 6.2.

## Contexto (código de la 6.2 sobre el que apila)

- `apps/api/src/documentos/presentation/modelo-documento-presupuesto.ts`:
  `construirModeloDocumentoPresupuesto(config, datos)` es **dominio de
  presentación puro** (no importa de `presupuestos`; el `regimen` llega en
  `DatosDocumentoPresupuesto.regimen: RegimenDocumento = 'con_iva' | 'sin_iva'`).
  Ya resuelve `cabecera.mostrarIdentidadFiscal` y `totales.mostrarDesgloseIva`
  desde `datos.regimen === 'con_iva'`.
- `PieBancarioModelo` (`{ iban; beneficiario; concepto }`) cuelga del modelo como
  `modelo.pieBancario`, y `DocumentoLayout` renderiza `<PieBancario …>`
  **incondicionalmente**.

## D1 — Dónde vive el flag

**Decisión**: añadir el flag de visibilidad al **`PieBancarioModelo`** como
`mostrar: boolean` (co-localizado con los datos que gobierna), en coherencia con
`cabecera.mostrarIdentidadFiscal` (dentro de `CabeceraModelo`) y
`totales.mostrarDesgloseIva` (dentro de `TotalesModelo`) de la 6.2.

`construirModeloDocumentoPresupuesto` lo resuelve igual que los otros dos flags,
de forma declarativa:

```
const mostrarPieBancario = datos.regimen === 'con_iva';
// …
pieBancario: {
  mostrar: mostrarPieBancario,
  iban: config.banca.iban,
  beneficiario: config.banca.beneficiarioTransferencia,
  concepto: config.banca.conceptoTransferencia,
},
```

Así **toda la lógica de variante recae en la función pura** (donde caen todas las
aserciones de contenido), sin condicionales dispersos.

## D2 — Quién omite el render

**Decisión**: el `DocumentoLayout` **no compone `<PieBancario>` cuando
`modelo.pieBancario.mostrar === false`** (renderizado condicional en el layout,
que ya es quien decide la composición). `PieBancario` sigue siendo un componente
"tonto" que solo pinta lo que recibe.

Alternativa descartada (más ruidosa): que `PieBancario` reciba el flag y devuelva
`null`. Se prefiere decidir la composición en el layout, que es el sitio natural
de la estructura del documento.

Nota: `pieLegal` se pasa hoy a `<PieBancario>` junto al bloque bancario. En SIN
IVA, al omitir el pie bancario, se decide en implementación si el pie legal se
mantiene en otra parte del layout o también se omite; el Excel "PRESSUPOST SENSE
IVA" termina en la Fiança, por lo que por defecto el bloque completo (bancario +
pie legal contiguo) se omite en SIN IVA. Esto se cubre con el test de re-render
(no debe aparecer IBAN/beneficiario/concepto de transferencia en SIN IVA).

## D3 — Sin impacto fuera de presentación

- **Cálculo fiscal**: sin cambios. `desglose` (base/IVA/total) y `reparto`
  (40/60/fiança) llegan ya resueltos; este fix no los toca.
- **Numeración**: sin cambios (`AAAANNN`, doble secuencia de la 6.2).
- **BD / migración Prisma**: ninguna. El flag es derivado del `regimen` ya
  persistido.
- **Contrato OpenAPI / SDK**: sin cambios (no hay superficie HTTP nueva).
- **Frontend / E2E**: sin cambios (render puramente backend del PDF).
- **Hexagonal**: `documentos` sigue sin importar de `presupuestos`; el flag se
  resuelve en presentación pura de `documentos`. Arrow functions (regla dura).

## Riesgo / regresión

Único riesgo: romper el render CON IVA. Se cubre con el escenario "CON IVA
conserva cabecera, totales y pie bancario" (test unitario del modelo + re-render
del PDF CON IVA verificando que **sí** aparece el IBAN/beneficiario).
