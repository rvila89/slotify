# Code review — presupuesto-datos-fiscales-cliente-inline (US-014 #5, Parte B)

- Fecha: 2026-07-13
- Revisor: code-reviewer (solo lectura)
- Alcance: `PATCH /reservas/{id}/datos-fiscales` (op `actualizarDatosFiscalesCliente`) +
  sección inline `DatosFiscalesClienteSection` en `GenerarPresupuestoDialog`.
- Base: `feature/presupuesto-datos-fiscales-cliente-inline` vs `master`.

## Verificaciones ejecutadas
- Backend unit + HTTP controller: `2 suites / 17 tests` PASS.
- Backend integración (Postgres real `slotify_test`): `1 suite / 5 tests` PASS
  (persistencia real, PATCH parcial, NO muta RESERVA/FECHA_BLOQUEADA, RLS).
- Frontend (vitest): `1 suite / 3 tests` PASS (precarga, guardar→confirmar, bucle D-5).
- ESLint backend (5 ficheros): EXIT 0. ESLint frontend (7 ficheros): EXIT 0
  (solo warnings de deprecación pre-existentes del plugin `boundaries`, no errores).
- SDK generado: regeneración desde `docs/api-spec.yml` produce un `schema.d.ts`
  BYTE-IDÉNTICO al del diff → NO hay edición a mano del cliente generado.
- `max-lines`: todos los ficheros ≤300 (mayor: `GenerarPresupuestoDialog.tsx` = 295).

## Hallazgos

### Bloqueantes
- Ninguno.

### Altos
- Ninguno.

### Medios
- Ninguno.

### Bajos (no bloquean; deuda opcional)
- **[margen max-lines]** `GenerarPresupuestoDialog.tsx` está en 295/300 líneas. Cumple,
  pero queda poco margen; una futura ampliación de la sección obligaría a extraer un
  sub-componente. Recomendación: tenerlo presente si crece.
- **[cobertura 401 en test HTTP]** `actualizar-datos-fiscales-cliente.controller.http.spec.ts`
  registra solo `RolesGuard` (sin `JwtAuthGuard` global), por lo que el caso "sin JWT"
  acepta `[401,403]`. En producción el `JwtAuthGuard` global (declarado en el controller
  vía `@ApiBearerAuth` + guard global de `main.ts`) devuelve 401. Es correcto para un test
  de contrato de controller; el 401 real queda cubierto por la configuración global. Sin acción.
- **[cast en adaptador de lectura]** `cargar-reserva-datos-fiscales.prisma.adapter.ts` usa
  `as ReservaDatosFiscales['datosFiscalesActuales']` sobre la proyección del cliente. Es
  seguro (los 5 campos son `string|null` en el schema y el tipo destino admite `string`),
  pero el `as` enmascara un posible `null` en columnas fiscales. No afecta a la corrección
  (el PATCH parcial y el fallback `?? previos.x` toleran null), pero podría tiparse el
  puerto `DatosFiscalesCliente` con `string|null` para eliminar el cast. Opcional.

## Checklist de guardarraíles

- **Hexagonal/DDD**: OK. Los tipos y puertos viven en `application/…use-case.ts`; NO hay
  fichero en `domain/` que importe framework/infra. El use-case no importa `@nestjs/*` ni
  `@prisma/*` (solo el puerto `AuditLogPort`). Adaptadores Prisma y controller en sus capas.
- **Multi-tenancy / RLS**: OK. `tenantId` y `usuarioId` SIEMPRE del JWT (`@CurrentUser`),
  nunca del body/path. La RESERVA se resuelve con `fijarTenant(tx, tenantId)` (SET LOCAL
  app.tenant_id) antes de la query; el CLIENTE se alcanza vía la RESERVA; `updateMany`
  filtra `tenantId`. Test de integración confirma que la reserva de OTRO_TENANT → 404 y no
  se muta el cliente ajeno.
- **Bloqueo atómico de fecha**: OK. El endpoint NO toca `FECHA_BLOQUEADA` ni estado de la
  RESERVA (verificado por integración: `no_debe_crear_ni_tocar_fecha_bloqueada` y
  `no_debe_cambiar_ningun_campo_de_la_reserva`). Sin Redis/locks distribuidos.
- **Máquina de estados**: OK. No se altera; UPDATE de columnas escalares del CLIENTE. Sin
  `if/else` de transición: los campos se recorren por `CLAVES_FISCALES` (tabla declarativa).
- **PATCH parcial (D-2)**: OK. Solo viajan al puerto los campos `!== undefined`
  (`extraerCamposPresentes` en use-case, `extraerDatos` en controller, `data` condicional en
  el adaptador). Los ausentes NO se ponen a null; se devuelven con su valor previo.
- **Arrow-functions**: OK. Helpers y componentes son arrow; los métodos de clase Nest quedan
  exentos (correcto). ESLint pasa.
- **DTOs / class-validator**: OK. `@IsOptional/@IsString/@MinLength(1)` + decorador de clase
  `AlMenosUnCampoFiscal` (minProperties:1); `forbidNonWhitelisted` cubre additionalProperties.
  400 verificado en el test HTTP (vacío, campo vacío, propiedad ajena).
- **Importes en Decimal**: N/A (este endpoint no maneja importes).
- **Contrato ↔ DTOs**: OK. `ActualizarDatosFiscalesClienteRequest/Response` en el YAML
  coinciden 1:1 con los DTOs y con el `schema.d.ts` regenerado.
- **Cliente HTTP generado no editado a mano**: OK (diff byte-idéntico a la regeneración).
- **Frontend estructura por dominio + barrel**: OK. Todo en `features/presupuestos/`
  (`api/ components/ model/`), exportado por `index.ts`; utilidades separadas en
  `datosFiscalesCampos.ts` y clases en `estilos.ts` para respetar react-refresh y max-lines.
- **Responsive (390/768/1280)**: OK. Grid `grid-cols-1 sm:grid-cols-2`; evidencia E2E en los
  3 viewports con capturas y sin overflow horizontal (bodyScrollWidth ≤ ancho en los tres).
- **Errores en español**: OK.
- **Tests primero (TDD)**: OK. Specs con cabecera RED explícita; cubren happy/parcial/errores
  400/403/404/multi-tenant + integración SQL real.

## Conclusión
El change respeta todos los guardarraíles duros de Slotify. Los tres hallazgos Bajos son
deuda opcional sin impacto en corrección, seguridad ni contrato. No hay Bloqueantes.

Veredicto: APTO
