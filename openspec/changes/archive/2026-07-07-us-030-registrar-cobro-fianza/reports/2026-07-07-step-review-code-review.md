# Code Review — US-030 Registrar cobro de la fianza

- **Change**: `us-030-registrar-cobro-fianza`
- **Branch**: `feature/us-030-registrar-cobro-fianza` (trabajo en árbol de trabajo; sin commits ahead de `master`)
- **Fecha**: 2026-07-07
- **Revisor**: code-reviewer (solo lectura)
- **Alcance**: diff de la feature (modificados + no rastreados) frente a `master`.

> NOTA: un intento previo abortó por un error transitorio de infraestructura ("API Error: Overloaded"),
> no por veredicto. Este informe se ha generado limpio y sobrescribe cualquier parcial anterior.

## Resumen

Slice vertical (backend + contrato + frontend) del registro del cobro de la fianza. La implementación
respeta los guardrails duros de Slotify: hexagonal (dominio puro, puertos en aplicación, adaptadores en
infra), bloqueo atómico con `SELECT ... FOR UPDATE` de PostgreSQL dentro de `$transaction` (sin locks
distribuidos), multi-tenancy/RLS (`SET LOCAL app.tenant_id` + `tenant_id` en toda mutación), máquina de
estados declarativa, validaciones de dominio (`importe > 0`, `fecha_cobro <= fecha_evento`), atomicidad
PAGO + FACTURA + fianza_status/fianza_eur/fianza_cobrada_fecha + AUDIT_LOG, política "Negociable" (D-2)
con confirmación y traza, y D-2(b) (borrador->cobrada o creación al vuelo). Contrato OpenAPI conforme y
cliente HTTP generado (no editado a mano). Frontend por dominio, arrow-functions, mobile-first.

**Punto de atención QA (invalidación de caché TanStack Query)**: revisado en profundidad. La mutation
`useRegistrarCobroFianza` invalida, SOLO en cobro efectivo (`resultado === 'cobrado'`), tanto
`facturasReservaQueryKey(reservaId)` como `reservaQueryKey(reservaId)`. `FichaConsultaPage` alimenta
`AccionesFacturacion` (`fianzaStatus`, `fianzaEur`, `fianzaCobradaFecha`) desde `useReserva` (query key
`['reserva', id]`), que ES la clave invalidada. El backend expone esos campos en `ReservaDetalle`
(`reserva-detalle-query.prisma.adapter.ts`, `reserva-detalle.dto.ts`) y el `GET /reservas/{id}` los
devuelve. Por tanto **la invalidación está correctamente cableada a la query que pinta la UI**: tras un
cobro efectivo la ficha refresca `fianza_status='cobrada'`, oculta el botón y muestra
`FianzaCobradaResumen` sin necesidad de renavegar. El helper `renavigar()` del E2E es un patrón de espera
de test (settle del refetch asíncrono en Playwright), NO un síntoma de invalidación ausente. **No es un
defecto de UX.** (Ver Observación O-1.)

## Verificaciones ejecutadas

- `pnpm --filter api typecheck` -> OK
- `pnpm --filter web typecheck` -> OK
- `pnpm --filter api lint` -> OK
- `pnpm --filter web lint` -> OK (solo warnings de deprecación del plugin boundaries, ajenos al código)
- `pnpm --filter api arch` (depcruise) -> OK, 0 violaciones (413 módulos)
- Jest US-030 (`validar` + `puede-registrar` + `use-case` + concurrencia real slotify_test) -> 59/59 PASSED
- Sin `any` ni `function` declarativo en el código de US-030 (back y front).

## Guardrails (checklist)

| Guardrail | Estado | Evidencia |
|-----------|--------|-----------|
| Hexagonal (dominio sin infra/framework) | OK | `domain/*.ts` puros (0 imports); use-case solo importa dominio; depcruise 0 violaciones |
| Bloqueo atómico `FOR UPDATE`, sin locks distribuidos | OK | `cobro-fianza-repository.prisma.adapter.ts` `$queryRaw ... FOR UPDATE`; UoW `$transaction`; sin Redis/Redlock |
| Multi-tenancy / RLS | OK | UoW `fijarTenant(tx, tenantId)` como 1.ª op; `tenant_id` en PAGO/FACTURA/DOCUMENTO/RESERVA/AUDIT_LOG; tenant del JWT (`@CurrentUser`), nunca del path |
| Máquina de estados (tabla/guarda) | OK | `puede-registrar-cobro-fianza.ts` declarativo; `recibo_enviado`->procede, `cobrada`->409, `pendiente`->Negociable |
| Validaciones (importe>0, fecha<=evento) | OK | `validar-cobro-fianza.ts` en céntimos enteros + comparación por día UTC (TZ-safe) |
| Atomicidad (PAGO+estados+campos+AUDIT) | OK | use-case orquesta todo dentro de `unidadDeTrabajo.ejecutar`; rollback total si lanza |
| AUDIT_LOG (cobro + flujo Negociable + salto) | OK | traza `crear` PAGO/FACTURA, `actualizar` FACTURA/RESERVA; `flujoExcepcional`/`salto` en Negociable/D-2b |
| Contrato: DTOs casan, cliente generado no tocado a mano | OK | `factura.dto.ts` espejo de `api-spec.yml`; `schema.d.ts` regenerado con el endpoint/tipos |
| D-2(b) (borrador->cobrada / crear al vuelo) | OK | `resolverFacturaFianza` cubre ambas ramas con su traza |
| Arrow-functions (func-style) | OK | 0 `function` declarativo; métodos de clase NestJS exentos |
| Frontend por dominio (boundaries, barrel, max-lines) | OK | `features/facturacion` con `api/components/lib/model`, barrel `index.ts`; lint OK |
| Responsive mobile-first (390/768/1280) | OK (con matiz) | clases `flex-col`/`sm:`/`lg:` en diálogo, acciones y resumen; E2E 8.4 reporta 3 viewports OK. Ver O-2 |
| Invalidación de caché tras cobro | OK | invalida `reserva` y `facturas-reserva`, que son las queries que pintan la UI |

## Hallazgos

### Bloqueante
Ninguno.

### Mayor
Ninguno.

### Menor
- **M-1 (contrato/robustez)** — `RegistrarCobroFianzaDto.importe` valida con `@Matches(IMPORTE_PATTERN)`
  `/^-?\d+\.\d{2}$/`, que ADMITE importes negativos a nivel de DTO (p. ej. `"-5.00"`). No es explotable:
  el dominio (`validarCobroFianza`) rechaza `<= 0` con `400 COBRO_INVALIDO` y no crea PAGO. Recomendación
  (no bloqueante): endurecer el patrón o añadir un validador de signo en el DTO para fallar antes y
  alinear el mensaje. Cubierto por tests de dominio y curl 7.7.

### Observación
- **O-1 (QA renavigar / caché)** — El helper `renavigar()` introducido en el E2E NO responde a una
  invalidación ausente: la caché se invalida correctamente sobre `['reserva', id]` (query que alimenta la
  ficha). Es una espera de settle de Playwright. Recomendación: sustituir `renavigar()` por
  `expect(...).toBeVisible()` con auto-retry sobre `fianza-cobrada-resumen` para no enmascarar futuras
  regresiones reales de invalidación. No afecta al veredicto.
- **O-2 (responsive)** — El diálogo `RegistrarCobroFianzaDialog` y el aviso `ConfirmacionCobroNegociable`
  usan corte `sm:` para el pie de botones, mientras que la convención del proyecto es `lg:` como corte
  mobile<->desktop (CLAUDE.md). Dentro de un `Dialog` centrado y estrecho el corte `sm:` es razonable y el
  E2E 8.4 valida 390/768/1280 sin overflow; se deja como observación de consistencia, no como defecto.
- **O-3 (justificante por texto libre)** — El campo "justificante" del formulario es un input de texto con
  la referencia (`justificanteDocId`) de un DOCUMENTO ya subido, coherente con D-5 (subida diferida fuera
  de alcance). Correcto para el MVP; se anota para la futura US de subida en el momento del cobro.

## Trazabilidad de decisiones

- **D-1** (atomicidad + FOR UPDATE): OK, verificado en use-case + adapter + test de concurrencia real.
- **D-2 / D-2(b)** (Negociable + confirmarSinRecibo + borrador/creación al vuelo): OK, front y back.
- **D-3** (endpoint `POST /reservas/{id}/facturas/fianza/cobro`, `fecha_cobro <= fecha_evento`): OK.
- **D-4** (frontend formulario + confirmación + guardas de UI): OK.
- **D-5** (justificante como DOCUMENTO opcional, puerto endurecido por tipo+reserva+tenant): OK.

## Conclusión

El diff cumple todos los guardrails duros; no se detectan bloqueantes ni mayores. Los hallazgos son un
menor de robustez del DTO (mitigado por el dominio) y observaciones de test/consistencia. La invalidación
de caché de TanStack Query es correcta y NO constituye defecto de UX.

Veredicto: APTO
