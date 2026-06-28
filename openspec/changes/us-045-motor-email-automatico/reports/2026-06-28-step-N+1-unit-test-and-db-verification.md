# Step N+1 — Unit tests y verificación de BD

- Fecha: 28/06/2026
- Change: us-045-motor-email-automatico
- Agente: qa-verifier

## Comandos ejecutados

- `EMAIL_TRANSPORT=fake npx jest --runInBand --testPathPatterns="comunicaciones" --verbose --reporters=default`
- `EMAIL_TRANSPORT=fake npx jest --runInBand --testPathPatterns="reservas" --verbose --reporters=default`
- `EMAIL_TRANSPORT=fake npx jest --runInBand` (suite completa)
- `pnpm run arch` (depcruise — validación de arquitectura hexagonal)
- `docker exec slotify-postgres psql ...` (capturas de baseline y verificaciones de BD)

## Resultados de unit tests

### Tests dirigidos: comunicaciones (9 suites)

```
PASS src/comunicaciones/comunicaciones.module.spec.ts
  ComunicacionesModule
    ✓ debe_definir_el_modulo

PASS src/comunicaciones/application/despachar-email.service.spec.ts
  DespacharEmailService — selección de plantilla y variables (2.1)
    ✓ debe_seleccionar_la_plantilla_por_codigo_email_y_el_idioma_del_tenant
    ✓ debe_sustituir_las_variables_de_la_plantilla_con_datos_de_reserva_y_cliente
    ✓ debe_enviar_con_el_asunto_y_cuerpo_renderizados_por_la_plantilla
    ✓ debe_caer_a_es_y_auditarlo_cuando_no_hay_plantilla_en_el_idioma_del_tenant
    ✓ debe_usar_es_por_defecto_cuando_el_tenant_no_tiene_idioma_configurado
  DespacharEmailService — registro en COMUNICACION (2.2)
    ✓ debe_registrar_enviado_con_fecha_envio_no_nula_cuando_el_proveedor_acepta
    ✓ debe_registrar_los_vinculos_tenant_reserva_y_cliente_correctos
    ✓ debe_registrar_borrador_sin_fecha_envio_cuando_no_es_autoenvio
    ✓ debe_dejar_fecha_envio_nula_cuando_el_estado_es_fallido
  DespacharEmailService — E1 auto-envío vía adaptador FAKE
    ✓ debe_enviar_E1_por_el_fake_dejar_la_comunicacion_enviada_con_fecha_y_auditar
    ✓ debe_dejar_E1_en_borrador_sin_enviar_por_el_fake_cuando_hay_comentarios
  DespacharEmailService — idempotencia por (reserva, código) (2.3)
    ✓ no_debe_duplicar_ni_reenviar_cuando_ya_existe_una_comunicacion_del_mismo_codigo
    ✓ debe_permitir_un_envio_y_frenar_el_segundo_cuando_dos_triggers_corren_en_carrera
  DespacharEmailService — fallo del proveedor (2.4)
    ✓ debe_marcar_fallido_sin_fecha_envio_y_auditar_cuando_el_proveedor_rechaza
    ✓ no_debe_reintentar_automaticamente_el_envio_tras_un_fallo_del_proveedor
    ✓ no_debe_propagar_el_error_del_proveedor_como_excepcion_al_llamador
  DespacharEmailService — variable de plantilla nula (2.5)
    ✓ no_debe_enviar_ni_crear_enviado_cuando_falta_una_variable_requerida
    ✓ debe_auditar_el_campo_faltante_para_que_el_gestor_complete_los_datos
  DespacharEmailService — adjuntos por referencia
    ✓ debe_incorporar_el_adjunto_al_envio_cuando_la_plantilla_lo_declara_y_el_pdf_url_existe
    ✓ no_debe_enviar_y_debe_auditar_cuando_un_adjunto_requerido_no_tiene_pdf_url
  DespacharEmailService — finalizarEnvio (envío post-commit de fila ya creada)
    ✓ debe_enviar_y_promover_la_fila_a_enviado_con_fecha_fijando_el_tenant_y_auditar
    ✓ debe_marcar_fallido_sin_fecha_y_auditar_sin_propagar_cuando_el_proveedor_falla
    ✓ no_debe_propagar_la_excepcion_del_proveedor_al_llamador

PASS src/comunicaciones/infrastructure/fake-email.adapter.spec.ts
  FakeEmailAdapter — transporte en memoria sin red (2.6)
    ✓ debe_implementar_el_puerto_de_dominio_EnviarEmailPort
    ✓ debe_registrar_en_memoria_cada_envio_sin_realizar_ninguna_llamada_de_red
    ✓ debe_acumular_los_envios_en_orden_para_las_aserciones
    ✓ debe_poder_simular_un_fallo_del_proveedor_para_los_tests_del_motor
    ✓ debe_aceptar_el_comando_extendido_con_campos_opcionales_retro_compatibles
    ✓ debe_seguir_aceptando_el_comando_minimo_de_cuatro_campos_de_US_003

PASS src/comunicaciones/infrastructure/plantillas/catalogo-plantillas.spec.ts
  CatalogoPlantillasEnCodigo — E1 activa y E2–E8 diseñadas/inactivas (2.7)
    ✓ debe_seleccionar_la_plantilla_E1_en_es_y_marcarla_como_activa
    ✓ debe_declarar_las_variables_requeridas_de_la_plantilla_E1
    ✓ debe_renderizar_la_plantilla_E1_con_asunto_y_cuerpo_a_partir_de_las_variables
    ✓ debe_declarar_E2_a_E8_como_disenadas_pero_inactivas_sin_trigger
    ✓ no_debe_tener_plantilla_en_un_idioma_no_provisto_para_que_el_motor_aplique_fallback

PASS src/comunicaciones/domain/tenant-settings.port.spec.ts
PASS src/comunicaciones/domain/comunicacion.repository.port.spec.ts
  ComunicacionRepositoryPort — contrato del puerto de dominio
    ✓ debe_aceptar_una_implementacion_que_busque_cree_y_actualice_estado
  ComunicacionDuplicadaError — colisión del índice UNIQUE parcial
    ✓ debe_ser_un_error_de_dominio_que_identifica_la_reserva_y_el_codigo_en_conflicto
PASS src/comunicaciones/domain/enviar-email.port.spec.ts
PASS src/comunicaciones/domain/codigo-email.spec.ts
PASS src/comunicaciones/domain/catalogo-plantillas.port.spec.ts
```

- Tests dirigidos comunicaciones: **42 passed, 0 failed, 0 skipped** (9 suites)
- Runtime: ~1.9 s
- Nota re-QA: +3 tests nuevos respecto a la primera QA (39→42), todos en `despachar-email.service.spec.ts` — sección `finalizarEnvio` añadida por fix B1.

### Tests dirigidos: reservas (11 suites — regresión US-003/004)

```
PASS src/reservas/__tests__/alta-consulta.controller.spec.ts
  AltaConsultaController — traducción de errores (MAYOR #1) ✓

PASS src/reservas/__tests__/alta-consulta.use-case.spec.ts
  AltaConsultaUseCase — crea el agregado en una única transacción (3.2) ✓
  AltaConsultaUseCase — E1 según comentarios (3.3) ✓
  AltaConsultaUseCase — fallo del proveedor en el alta (E1 fallido) ✓  ← NUEVO (fix B1)
    ✓ debe_dejar_E1_en_fallido_sin_fecha_y_NO_tumbar_el_alta_cuando_el_proveedor_falla
    ✓ no_debe_rechazar_el_alta_por_un_fallo_de_email_resuelve_siempre
  AltaConsultaUseCase — find-or-create de CLIENTE (3.4) ✓
  AltaConsultaUseCase — auditoría del alta (3.5) ✓
  AltaConsultaUseCase — validación sin efectos colaterales (3.6) ✓
  AltaConsultaUseCase — atomicidad transaccional (3.7) ✓

PASS src/reservas/__tests__/bloquear-fecha-integracion.spec.ts
PASS src/reservas/__tests__/bloquear-fecha-check-constraints.spec.ts
PASS src/reservas/__tests__/bloquear-fecha.service.spec.ts
PASS src/reservas/__tests__/liberar-fecha-integracion.spec.ts
PASS src/reservas/__tests__/liberar-fecha.service.spec.ts
PASS src/reservas/__tests__/fecha-bloqueada-concurrencia.spec.ts
PASS src/reservas/__tests__/maquina-estados.spec.ts
PASS src/reservas/__tests__/unidad-de-trabajo.prisma.adapter.spec.ts
PASS src/reservas/reservas.module.spec.ts
```

- Tests dirigidos reservas: **100 passed, 0 failed, 0 skipped** (11 suites)
- Runtime: ~2.7 s
- Nota re-QA: +2 tests nuevos respecto a la primera QA (98→100), ambos en `alta-consulta.use-case.spec.ts` — sección `fallo del proveedor en el alta` añadida por fix B1.

### Suite completa (re-QA post fix B1)

- Suite requerida (`EMAIL_TRANSPORT=fake npx jest --runInBand`): **235 passed, 0 failed, 0 skipped** (41 suites)
- Runtime: ~2.4 s
- Notas: el log muestra `ERROR [HttpExceptionFilter] DB connection lost` (test de auth que simula error de BD) — es comportamiento esperado de ese test; no es un fallo real.
- Incremento respecto a primera QA: 226 → 235 (+9 tests; desglose: +3 en `DespacharEmailService.finalizarEnvio`, +2 en `AltaConsultaUseCase.fallo del proveedor`, +4 en otros módulos).

### Validación de arquitectura hexagonal

- `pnpm run arch` (`depcruise src`): **no dependency violations found (139 modules, 356 dependencies cruised)**
- El módulo `comunicaciones/domain/` no importa infraestructura ni framework (guardrail `no-infra-in-domain` confirmado).

## Verificación del índice UNIQUE parcial en BD (tarea 4.4)

### Baseline previo a los tests

| Tabla | Count |
|-------|-------|
| `comunicacion` | 0 |
| `audit_log` | 55 |
| `reserva` | 0 |
| `cliente` | 0 |

### Índice presente en `slotify_dev` (re-verificado en re-QA)

```
uq_comunicacion_reserva_codigo
  UNIQUE btree (reserva_id, codigo_email) WHERE (reserva_id IS NOT NULL)
```

Aplicado por la migración `20260628120000_us045_comunicacion_idempotencia_indice` (confirmado en `_prisma_migrations`).

Re-verificación: `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'comunicacion' AND indexname LIKE '%uq%'` — índice presente y correcto.

### Test 1: rechazo de duplicado con reserva_id no nulo

Transacción de prueba (con `SET session_replication_role = replica` para bypass de FK):
1. INSERT cliente `test-cli-001` → OK
2. INSERT reserva `test-res-001` → OK
3. INSERT comunicacion `test-com-001` (reserva_id=`test-res-001`, codigo_email=`E1`) → OK
4. INSERT comunicacion `test-com-002` (MISMO reserva_id=`test-res-001`, MISMO codigo_email=`E1`) → **ERROR**

```
ERROR:  duplicate key value violates unique constraint "uq_comunicacion_reserva_codigo"
DETAIL:  Key (reserva_id, codigo_email)=(test-res-001, E1) already exists.
```

**Resultado: RECHAZO CORRECTO. Segundo insert rechazado con P2002-equivalente.**

### Test 2: permisividad con reserva_id = NULL (índice parcial no aplica)

1. INSERT comunicacion `test-com-n01` (reserva_id=NULL, codigo_email=`E1`) → OK
2. INSERT comunicacion `test-com-n02` (MISMO reserva_id=NULL, MISMO codigo_email=`E1`) → **OK** (sin error)

**Resultado: CORRECTO. El índice parcial no aplica cuando reserva_id es NULL (emails manuales de US-046).**

Ambas transacciones de prueba fueron ROLLBACK; no mutaron la BD.

## Verificación de estado posterior de BD

| Tabla | Count pre-tests | Count post-tests | Delta |
|-------|----------------|------------------|-------|
| `comunicacion` | 0 | 0 | 0 |
| `audit_log` | 55 | 55 | 0 |
| `reserva` | 0 | 0 | 0 |
| `cliente` | 0 | 0 | 0 |

- Estado restaurado: **No fue necesario restaurar** — los tests son unitarios (in-memory/dobles) y no mutaron la BD; las pruebas de índice usaron transacciones con ROLLBACK explícito.
- Acciones de restauración: ninguna.

## Resultado

- Estado de step-N+1: **PASS** (confirmado en primera QA y re-QA)
- Regresión US-003/004: **CERO** (alta-consulta.use-case.spec.ts y alta-consulta.controller.spec.ts en verde; 33 tests en 2 suites)
- Índice UNIQUE parcial: **VERIFICADO** (rechazo duplicado sí / NULL no aplica sí)
- Suite post-fix B1: **235 passed, 0 failed** — incluye los 9 tests nuevos del fix
- Bloqueantes: ninguno

---

## Re-verificación — fix B1 (28/06/2026, re-QA)

Tras el code-review (veredicto NO APTO por B1), se aplicó el fix que cambia el flujo de alta E1:

### Cambio observable

| Paso | Antes del fix B1 | Después del fix B1 |
|------|-----------------|---------------------|
| Dentro de la transacción | COMUNICACION E1 nace en `enviado` (estado final) | COMUNICACION E1 nace en `borrador` (estado NO final) |
| Post-commit (sin comentarios) | `AltaConsultaUseCase` llama directamente a `EnviarEmailPort.enviar()` sin try/catch | Delega en `DespacharEmailService.finalizarEnvio` (motor centralizado) |
| Fallo del proveedor | Propaga excepción → HTTP 500; COMUNICACION queda en `enviado` pese a no enviar | Motor captura → COMUNICACION actualizada a `fallido` + AUDIT_LOG; HTTP 201 igualmente |
| Con comentarios | Sin cambio (COMUNICACION `borrador`, sin envío) | Sin cambio (COMUNICACION `borrador`, sin envío) |

### Tests nuevos en verde (cobertura del gap `fallido`)

**`alta-consulta.use-case.spec.ts` — sección añadida:**
```
AltaConsultaUseCase — fallo del proveedor en el alta (E1 fallido)
  ✓ debe_dejar_E1_en_fallido_sin_fecha_y_NO_tumbar_el_alta_cuando_el_proveedor_falla
  ✓ no_debe_rechazar_el_alta_por_un_fallo_de_email_resuelve_siempre
```

**`despachar-email.service.spec.ts` — sección añadida:**
```
DespacharEmailService — finalizarEnvio (envío post-commit de fila ya creada)
  ✓ debe_enviar_y_promover_la_fila_a_enviado_con_fecha_fijando_el_tenant_y_auditar
  ✓ debe_marcar_fallido_sin_fecha_y_auditar_sin_propagar_cuando_el_proveedor_falla
  ✓ no_debe_propagar_la_excepcion_del_proveedor_al_llamador
```

Todos en VERDE. BD no mutada (tests unitarios in-memory).

---

## Re-verificacion — fix Bj3 (29/06/2026, re-QA minimo sin E2E ni curl)

### Contexto del fix

Deuda Bj3 del code-review: el DEFAULT de `EMAIL_SANDBOX` no era seguro (unset podia habilitar envios reales si `ConfigService` resolvía el campo como falsy en lugar de `true`). El fix:

- `apps/api/src/config/env.validation.ts`: `EMAIL_SANDBOX` se define como `z.enum(['true','false']).optional().transform((v) => v !== 'false')` — el transform devuelve `true` para cualquier valor que no sea el literal `'false'`, incluido `undefined`.
- `apps/api/src/comunicaciones/comunicaciones.module.ts`: la factory de `ENVIAR_EMAIL_PORT` aplica la misma guarda doble: `!(sandboxRaw === false || sandboxRaw === 'false')`, cubriendo tanto el boolean resuelto por zod como el string raw que pudiera llegar.
- `apps/api/src/config/env.validation.spec.ts`: 3 nuevos tests para los 3 escenarios del default seguro.

### Comandos ejecutados

```
# 1. Suite de env.validation (afectada directamente por Bj3)
npx jest --runInBand --no-coverage --testPathPatterns="env.validation" --verbose --reporters=default

# 2. Suites dirigidas: comunicaciones + reservas (regresion)
npx jest --runInBand --no-coverage --testPathPatterns="env.validation|comunicaciones|reservas" --verbose --reporters=default

# 3. Suite completa
npx jest --runInBand --no-coverage

# 4. Validacion de arquitectura hexagonal
npx depcruise src
```

### Resultados

#### env.validation.spec.ts — 11 tests (3 nuevos Bj3)

```
PASS src/config/env.validation.spec.ts
  validarEntorno
    v debe_aceptar_un_entorno_valido
    v debe_fallar_si_falta_DATABASE_URL
    v debe_fallar_si_JWT_ACCESS_SECRET_esta_vacio
    v debe_fallar_si_JWT_ACCESS_SECRET_tiene_menos_de_32_chars
    v debe_fallar_si_en_produccion_el_transporte_de_email_es_fake
    v debe_fallar_si_en_produccion_no_se_indica_transporte_y_cae_al_default_fake
    v debe_aceptar_produccion_con_resend_y_sus_secretos
    v debe_permitir_fake_fuera_de_produccion_test_y_development
    v debe_activar_sandbox_por_defecto_cuando_EMAIL_SANDBOX_no_esta_seteada   <- Bj3 caso 1
    v debe_mantener_sandbox_activo_con_EMAIL_SANDBOX_true                     <- Bj3 caso 2
    v debe_desactivar_sandbox_solo_con_EMAIL_SANDBOX_false_explicito          <- Bj3 caso 3

Test Suites: 1 passed, 1 total
Tests:       11 passed, 11 total
```

#### Los 3 casos del default seguro (Bj3) — verificacion explicita

| Caso | Entrada `EMAIL_SANDBOX` | Valor esperado | Resultado |
|------|------------------------|---------------|-----------|
| unset (no seteada) | `undefined` | `true` (sandbox activo) | VERDE |
| literal `'true'` | `'true'` | `true` (sandbox activo) | VERDE |
| literal `'false'` (opt-in explícito) | `'false'` | `false` (envio real) | VERDE |

#### Suites dirigidas: env.validation + comunicaciones + reservas

- **21 suites, 153 tests** — todos VERDE
- comunicaciones (9 suites / 42 tests): VERDE — `FakeEmailAdapter.debe_registrar_en_memoria_cada_envio_sin_realizar_ninguna_llamada_de_red` confirma cero envios reales en test
- reservas (11 suites / 100 tests): VERDE — regresion US-003/004 sin regresion

#### Suite completa

```
Test Suites: 41 passed, 41 total
Tests:       238 passed, 238 total   <- +3 respecto a re-QA post-B1 (235+3 tests Bj3)
Snapshots:   0 total
Time:        ~2.4 s
```

El log muestra `ERROR [HttpExceptionFilter] DB connection lost` (test de auth que simula error de BD) — comportamiento esperado, no es fallo real.

#### Validacion de arquitectura hexagonal

```
depcruise src: no dependency violations found (139 modules, 353 dependencies cruised)
```

### Estado de BD

No aplica — todos los tests son unitarios in-memory. BD no mutada, sin restauracion necesaria.

### Confirmaciones clave

- Fix Bj3 verificado: DEFAULT seguro funciona en los 3 escenarios (unset, 'true', 'false')
- Cero envios reales en test: FakeEmailAdapter forzado; no hay llamada de red en ninguna suite
- Regresion US-003: CERO — alta-consulta sigue en verde
- Arquitectura hexagonal: limpia

### Resultado

**PASS — fix Bj3 verificado. 238/238 tests verdes. Cero envios reales. Sin regresion.**
