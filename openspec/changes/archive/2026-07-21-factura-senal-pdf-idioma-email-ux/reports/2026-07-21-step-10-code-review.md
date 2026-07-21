# Code review — factura-senal-pdf-idioma-email-ux (step 10)

Fecha: 2026-07-21
Revisor: code-reviewer (solo lectura)
Rama: worktree-feature-factura-senal-pdf-idioma-email-ux
Commit: 292605f — feat(facturacion): PDF bilíngüe, email E3 aprobado, flag e3Enviado y UX envío/reenvío

## Alcance revisado
Diff completo `master...HEAD` (35 ficheros). Backend `facturacion`/`documentos`/`comunicaciones`, frontend `features/facturacion`, contrato `docs/api-spec.yml`, cliente generado `schema.d.ts`, artefactos OpenSpec.

## Verificación de tests
`npx jest` sobre las 4 suites del change: **85/85 passing**.
- `documentos/presentation/__tests__/modelo-documento-factura.spec.ts` (idioma ES/CA conceptos + pieLegal).
- `comunicaciones/.../catalogo-plantillas-e3.spec.ts` (E3 bilíngüe, escape HTML, variablesRequeridas).
- `comunicaciones/.../catalogo-plantillas.spec.ts` (ajuste variablesRequeridas E3).
- `facturacion/__tests__/enviar-factura-senal.use-case.spec.ts` (idioma propagado + nombre del adjunto).

## Hallazgos por severidad

### Bloqueantes
- Ninguno.

### Altas
- Ninguna.

### Medias
- Ninguna.

### Bajas
- **[correctitud/latente] `ObtenerFacturaSenalUseCase.ejecutarPorFactura`** no fija `e3Enviado`
  (`obtener-factura-senal.use-case.ts:92-104`). Los endpoints POST aprobar (`factura.controller.ts:279`)
  y rechazar (`:305`) mapean por `aDto`, que hace `r.e3Enviado ?? false`, así que esas respuestas
  siempre devuelven `e3Enviado: false`. No es un bug funcional: aprobar/rechazar operan sobre un
  `borrador` (E3 aún no puede haberse enviado, siempre es `false` de hecho) y el frontend
  (`FacturaSenalCard`) solo consume `e3Enviado` desde el GET, que sí lo resuelve. Recomendación:
  documentar el invariante o resolver `e3Enviado` también en `ejecutarPorFactura` para eliminar el
  camino que depende del fallback.

## Checklist de guardrails

1. **Hexagonal** — OK. `domain/` no gana imports de framework/infra (solo `cargar-datos-documento-factura.port.ts`
   añade el campo `idioma: string`, es una interfaz pura). `VerificarE3EnviadoPort` se declara en
   `application/obtener-factura-senal.use-case.ts` (interfaz pura) y el adaptador Prisma vive en
   `infrastructure/lecturas-emision.prisma.adapter.ts`. Esta co-localización de puertos "driven" en el
   use-case es la **convención establecida** del módulo (idéntica a `CargarReservaSenalEmisionPort`,
   `EnviarE3EmisionPort`, etc.); la capa `application/` no importa de `infrastructure/`. Sin violación.
2. **Arrow functions** — OK. Ningún `function` declarativo introducido; `tituloPorTipo`/`etiquetaMetaPorTipo`
   son arrow, los renders `renderE3`/`renderE3Ca` son arrow, adaptadores usan campos-flecha (`readonly verificar =`).
   Métodos de clase NestJS exentos.
3. **Multi-tenancy** — OK. `VerificarE3EnviadoPrismaAdapter` usa `$transaction` + `fijarTenant(tx, tenantId)`
   (RLS) **y** filtra `tenantId` explícito en el `where` (belt-and-suspenders, patrón idéntico a sus hermanos).
   El `tenantId` proviene del comando (JWT), nunca del body/path.
4. **Seguridad (email E3)** — OK. `renderE3`/`renderE3Ca` interpolan `nombre`/`codigoReserva` vía `htmlEscape`
   antes de construir `cuerpoHtml` (`p => \`<p>${htmlEscape(p)...}\``). Test de anti-injection verde
   (`<script>` → `&lt;script&gt;`). Los adaptadores E3 ya no hardcodean texto: delegan en el catálogo.
5. **Contrato** — OK y coherente en las tres capas:
   - `docs/api-spec.yml`: `FacturaSenalDto` `allOf` + `required: [e3Enviado]`, `type: boolean`.
   - `factura.dto.ts`: `FacturaSenalDto extends FacturaDto { e3Enviado!: boolean }` con `@ApiProperty`.
   - `factura.controller.ts` `aDto`: `e3Enviado: r.e3Enviado ?? false` (campo siempre presente, no-null).
   - Cliente generado `schema.d.ts` regenerado (no editado a mano): intersección con `{ e3Enviado: boolean }`.
6. **Frontend estructura** — OK. Componentes en `components/*.tsx`; el nuevo tipo/uso de `Factura` vive en
   `model/types.ts`; helpers de estado en `lib/estado.ts`. `EnvioFacturaSenal` recibe `e3Enviado` como prop
   y muestra una sola acción (enviar XOR reenviar). Invalidación de `comunicacionesReservaQueryKey` en
   `onSuccess` de ambos hooks, importando la feature comunicaciones por su barrel `@/features/comunicaciones`.
7. **Responsive** — Sin regresión. `EnvioFacturaSenal` conserva mobile-first (`h-11`, `w-full sm:w-auto`,
   apilado `<sm`); el cambio es condicional de render, no de layout. No aplica evidencia de 3 viewports por
   no haber pantalla nueva ni cambio estructural de layout (se elimina un banner y se alterna un botón).
8. **Importes/Decimal** — N/A. El change no toca cálculo de importes (el desglose fiscal ya congelado se
   propaga sin transformación).
9. **Convenciones ES** — OK. Nombres y comentarios en español; textos de marca E3 aprobados ES/CA.
10. **Cliente HTTP generado** — OK. `schema.d.ts` es coherente con el `.yml` (regenerado, no manual).

## Veredicto
Todos los guardrails duros se cumplen. Único hallazgo es de severidad Baja (latente, sin impacto
funcional ni de contrato gracias al fallback `?? false`).

Veredicto: APTO
