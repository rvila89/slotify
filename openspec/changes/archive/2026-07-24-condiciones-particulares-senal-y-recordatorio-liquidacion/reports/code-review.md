# Informe de code-review — condiciones-particulares-senal-y-recordatorio-liquidacion

Fecha: 2026-07-24
Revisor: code-reviewer (solo lectura)
Alcance: working tree vs `master` (los cambios están sin commitear; `HEAD == master`).
Suite dirigida ejecutada por el revisor: 6 suites, **155/155 tests en verde**
(`enviar-factura-senal`, `reenviar-e3`, `enviar-factura-liquidacion`,
`generar-presupuesto`, `catalogo-plantillas`, `catalogo-plantillas-e2`).

## Resumen

El change revierte la "Mejora B" (condiciones en E2 + guarda dura 409) y reubica las
condiciones particulares en E3 de forma degradable, añade el recordatorio condicional en
E4 y elimina la guarda dura y su 409. La implementación es fiel a la propuesta y respeta
los guardrails duros (hexagonal, dominio puro, arrow functions, multi-tenancy/RLS, sin
locks distribuidos). No se detecta ningún bloqueante.

## Hallazgos por severidad

### Bloqueantes
- (ninguno)

### Alta
- (ninguno)

### Media
- **[código muerto] Puerto/adapter/token `BuscarDocumentoCondiciones` huérfanos.** Tras
  sustituir el reenvío por `GenerarPdfCondicionesPort`, quedan definidos pero ya no
  cableados:
  - `apps/api/src/facturacion/application/reenviar-e3.use-case.ts:193`
    (`interface BuscarDocumentoCondicionesPort`, ya no está en `ReenviarE3Deps`).
  - `apps/api/src/facturacion/infrastructure/lecturas-emision.prisma.adapter.ts:309`
    (`class BuscarDocumentoCondicionesPrismaAdapter`) + su import en la línea 32.
  - `apps/api/src/facturacion/facturacion.tokens.ts:91`
    (`BUSCAR_DOCUMENTO_CONDICIONES_PORT`).
  El provider y las importaciones sí se retiraron de `facturacion.module.ts`, así que NO
  hay wiring roto ni doble fuente de verdad en runtime: es deuda de limpieza, no un
  blocker. Recomendación: eliminar el puerto, el adapter, su import y el token (y el tipo
  `DocumentoCondicionesReenvio` si queda huérfano) para no dejar un lector de DOCUMENTO
  stale que induzca a error en el futuro. Nota: el adapter muerto igualmente filtra
  `tenant_id` + `fijarTenant`, así que aunque se dejara no viola multi-tenancy.

### Baja
- **[claridad] `condPartFirmadas?: boolean` con `!undefined === true`.** En
  `enviar-factura-liquidacion.use-case.ts:432`, `recordarCondicionesPendientes =
  !reserva.condPartFirmadas`. El campo es opcional en el modelo de aplicación pero el
  read path (`lecturas-emision.prisma.adapter.ts:78`) lo puebla SIEMPRE y en Prisma
  `condPartFirmadas Boolean @default(false)` es NO nullable, luego en producción nunca es
  `undefined`. El fallback `!undefined === true` (recordar cuando falta el dato) es el
  default seguro correcto (recordar de más, no callar de más). Se acepta; la optatividad
  solo sirve a los dobles de test. No requiere cambio.

## Verificación del checklist / guardrails

1. **Hexagonal / dominio puro (OK).** `GenerarPdfCondicionesPort`
   (`documentos/domain/generar-pdf-condiciones.port.ts`) es interfaz pura (sin `@nestjs`,
   `@prisma`, react-pdf). Los use-cases la referencian solo con `import type`; no importan
   infra. Grep de `infrastructure|@nestjs|@prisma|PrismaService` en
   `facturacion/application/` solo devuelve líneas de comentario.
2. **PRE-TX correcto (OK).** `enviar-factura-senal.use-case.ts`: el
   `generarCondiciones.generar(...).catch(() => null)` ocurre ANTES del bucle
   `unidadDeTrabajo.ejecutar(...)`; la URL se pasa a `emitir(...)` como argumento.
   `reenviar-e3.use-case.ts`: idéntico patrón, generación fuera de la consolidación.
3. **`.catch(() => null)` presente (OK).** Ambos use-cases degradan a `null` sin propagar.
4. **`fijarCondicionesEnviadas` dentro de tx y solo si hay adjunto (OK).** En emisión, se
   invoca sobre `repos.reservas` DENTRO de `emitir(...)` (dentro de la UoW) y bajo
   `if (condicionesAdjuntas)`. En reenvío, bajo `if (urlCondiciones !== null)`.
   `condPartEnviadasFecha` del resultado solo se avanza si se adjuntó.
5. **No guarda dura (OK).** `CondicionesNoConfiguradasError`,
   `asegurarCondicionesConfiguradas`, `GenerarCondicionesPort` (el duplicado de
   presupuestos) y el mapeo `409 CONDICIONES_NO_CONFIGURADAS` del controller han
   desaparecido del código de producción (verificado por grep en `apps/`).
6. **`BUSCAR_DOCUMENTO_CONDICIONES_PORT` (ver Media).** Código muerto, no wired → deuda
   menor, no blocker.
7. **`condPartFirmadas` opcional (ver Baja).** Comportamiento correcto.
8. **Plantillas E2/E3/E4 (OK).** `renderE2`/`renderE2Ca` ya no mencionan condiciones;
   `renderE3`/`renderE3Ca` añaden el párrafo solo con `condicionesAdjuntas === true`;
   `renderE4`/`renderE4Ca` añaden el recordatorio solo con
   `recordarCondicionesPendientes === true`. Bilingüe ES/CA en los tres.
9. **Módulo facturación (OK).** `GENERAR_PDF_CONDICIONES_PORT` inyectado en ambos
   use-cases (`EnviarFacturaSenalUseCase` y `ReenviarE3UseCase`);
   `ReservaSenalEmisionPrismaRepository` cableado en la UoW de emisión;
   `presupuestos.module.ts` retira el wiring de condiciones de E2 y del use-case.
10. **Arrow functions (OK).** Sin `function` declarativo en los ficheros tocados; solo
    métodos de clase (exentos).
11. **Multi-tenancy / RLS (OK).** `ReservaSenalEmisionPrismaRepository.fijarCondicionesEnviadas`
    hace `update where: { idReserva }` sin `tenant_id` explícito, igual que el repo
    hermano `FacturaSenalEmisionPrismaRepository.emitir`: el aislamiento lo da la UoW con
    `prisma.fijarTenant(tx, tenantId)` (RLS) antes de instanciar los repos. Patrón
    consistente con el resto de la emisión de señal. El `generarCondiciones.generar`
    recibe `tenantId` del comando (procedente del JWT), no del path/body.

## Contrato + SDK
- `docs/api-spec.yml`: `CONDICIONES_NO_CONFIGURADAS` ya no aparece (grep sin resultados).
- `apps/web/src/api-client/schema.d.ts`: regenerado; el enum se reduce y las descripciones
  se actualizan de forma coherente (no es edición a mano; coincide con el contrato).
- Frontend: eliminado el caso `condiciones-no-configuradas` en
  `normalizarErrorReenvioE3.ts`, `model/types.ts`, `AccionReenviarE3.tsx` y
  `AvisoErrorReenvioE3.tsx` sin tocar el resto del manejo de errores de reenvío E3.

## Responsive (frontend)
- El change no añade UI nueva ni layouts; solo elimina ramas de manejo de error de reenvío
  E3 (toast/aviso inline preexistente). No aplica evidencia de 3 viewports.

## Recomendación
Apto para merge. Se recomienda (no bloqueante) limpiar el código muerto del hallazgo Media
en este mismo change o abrir una deuda de seguimiento para eliminar
`BuscarDocumentoCondicionesPort` / `BuscarDocumentoCondicionesPrismaAdapter` /
`BUSCAR_DOCUMENTO_CONDICIONES_PORT`.

Veredicto: APTO
