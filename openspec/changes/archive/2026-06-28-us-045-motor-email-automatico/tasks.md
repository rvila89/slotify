# Tasks — us-045-motor-email-automatico

> Orden y pasos obligatorios según `openspec/config.yaml` y
> `docs/openspec-tasks-mandatory-steps.md`. El AGENTE DEBE ejecutar él mismo todas
> las pruebas; NUNCA delega tests/curl/E2E en el usuario. Marcar `[x]` solo tras
> ejecutar y verificar.

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Crear branch `feature/us-045-motor-email-automatico` desde `master`
- [x] 0.2 Verificar la branch creada y la branch actual

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd — PARADA)
- [x] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/comunicaciones/spec.md`)
      + `design.md` y ESPERAR su OK explícito
- [x] 1.2 Confirmar con el humano la **resolución de la tensión de alcance**: AHORA
      = motor + E1 real (cierre DT-EMAIL-01); DIFERIDO = cableado de E2–E8 a sus US
- [x] 1.3 Confirmar las **6 decisiones de diseño** (proveedor+sandbox; síncrono vs
      barrido; plantillas/i18n; idempotencia/migración; modelo COMUNICACION;
      regresión del STUB). NO avanzar sin OK.

## 2. Tests primero — TDD RED (OBLIGATORIO — tdd-first)
- [x] 2.1 Tests del motor: selección de plantilla por código + idioma del tenant
      (fallback `es`) y sustitución de variables desde RESERVA/CLIENTE (en rojo)
- [x] 2.2 Tests de registro en COMUNICACION: estado `enviado`/`borrador`/`fallido` y
      `fecha_envio` coherente (no nulo solo si `enviado`)
- [x] 2.3 Tests de idempotencia `(reserva_id, codigo_email)`: segundo disparo no
      duplica; carrera concurrente frenada por el índice UNIQUE parcial
- [x] 2.4 Tests de fallo de proveedor: `estado='fallido'` + AUDIT_LOG, sin reintento
- [x] 2.5 Tests de variable nula: no envía, no crea `enviado`, registra AUDIT_LOG
- [x] 2.6 Tests del adaptador fake (sin red) y del contrato del puerto extendido
      (campos opcionales retro-compatibles)
- [x] 2.7 Tests de catálogo: E1 activa; E2–E8 declaradas como diseñadas/inactivas
- [x] 2.8 Confirmar que toda la suite nueva está en ROJO antes de implementar

## 3. Backend: revisar y actualizar tests unitarios existentes (OBLIGATORIO — step-N)
- [x] 3.1 Ejecutar baseline VERDE de US-003/004
      (`alta-consulta.use-case.spec.ts`, `alta-consulta.controller.spec.ts`,
      `enviar-email.port.spec.ts`) ANTES de tocar nada (garantía de regresión cero)
- [x] 3.2 Ajustar (si procede) los dobles del puerto en US-003/004 al comando
      extendido con opcionales, sin cambiar su comportamiento observable
      (NO procedió: el comando se extendió SOLO con opcionales retro-compatibles, por
      lo que los dobles de US-003/004 compilan y pasan sin cambios — regresión cero)
- [x] 3.3 Implementar: migración índice UNIQUE parcial; motor (`DespacharEmailService`);
      puertos `CatalogoPlantillasPort` y repositorio COMUNICACION; adaptadores
      Resend + fake; catálogo de plantillas (E1 activa); re-binding del módulo;
      validación de entorno (`EMAIL_TRANSPORT`/`RESEND_API_KEY`/`EMAIL_FROM`).
      Cierre de DT-EMAIL-01 / cableado E1 real. **Fix B1 del code-review (28/06):** el
      `AltaConsultaUseCase` SÍ delega el envío post-commit en el motor
      (`DespacharEmailService.finalizarEnvio`) honrando la decisión 6 del Gate 1,
      preservando a la vez la atomicidad de US-003: la COMUNICACION E1 nace en
      `borrador` (estado NO final, sin `fecha_envio`) DENTRO de la unidad de trabajo y
      el motor la PROMUEVE post-commit a `enviado`+`fecha` (éxito) o `fallido`+AUDIT_LOG
      (fallo del proveedor), sin reintento y sin tumbar el 201. El camino de éxito/fallo
      queda centralizado en el motor (`enviarYFinalizar`/`finalizarEnvio`). **M1:** RLS
      (`SET LOCAL app.tenant_id`) añadido a `buscarPorReservaYCodigo` y
      `actualizarEstado` del repo del motor. **M2:** `env.validation` fuerza
      `EMAIL_TRANSPORT=resend` en producción.

## 4. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [x] 4.1 Capturar baseline de BD de `comunicacion` y `audit_log` (counts/registros)
- [x] 4.2 Ejecutar tests dirigidos de `comunicaciones` y de `reservas` (alta E1)
- [x] 4.3 Ejecutar la suite requerida (`pnpm test`) y confirmar regresión cero en
      US-003/004
- [x] 4.4 Aplicar la migración en BD de prueba y verificar el índice UNIQUE parcial
      (intento de inserción duplicada rechazado)
- [x] 4.5 Verificar estado posterior de BD y restaurar si hace falta
- [x] 4.6 Crear report `openspec/changes/us-045-motor-email-automatico/reports/2026-06-28-step-N+1-unit-test-and-db-verification.md`
- [x] 4.7 Marcar completado solo tras tests en verde y report creado

## 5. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)
- [x] 5.1 Levantar el backend con `EMAIL_TRANSPORT=fake` (o sandbox de Resend)
- [x] 5.2 Alta de consulta SIN comentarios (`POST /reservas`) → verificar
      `COMUNICACION` E1 `enviado` + `fecha_envio`; restaurar BD
- [x] 5.3 Alta de consulta CON comentarios → verificar `COMUNICACION` E1 `borrador`
      sin `fecha_envio`; restaurar BD
- [x] 5.4 Simular fallo de proveedor → tras el fix B1 el camino `fallido` SÍ es
      alcanzable en el flujo de alta (delegación al motor): cubierto por
      `alta-consulta.use-case.spec.ts` (E1 fallido → COMUNICACION `fallido` sin fecha +
      HTTP 201) y por `despachar-email.service.spec.ts` (`finalizarEnvio` fallido +
      AUDIT_LOG). Gap curl documentado: `FakeEmailAdapter.forzarFallo` no es alcanzable
      via HTTP; gap unit CERRADO — 5 tests nuevos en verde (2 en use-case + 3 en motor).
      BD: estado `fallido` verificado a través del mock `actualizarEstado` en los tests
      del motor; adaptador Prisma y enum `EstadoComunicacion.fallido` confirmados.
- [x] 5.5 Reintentar el mismo trigger (idempotencia) → GAP documentado en report (no
      alcanzable via alta; cubierto por motor unit + índice UNIQUE verificado en 4.4)
- [x] 5.6 Caso de variable nula (email cliente nulo) → GAP documentado en report (no
      alcanzable via alta; cubierto por motor unit); alta devuelve 400 ante email
      inválido antes de crear ningún registro
- [x] 5.7 Crear report `…/reports/2026-06-28-step-N+2-curl-endpoint-tests.md`

## 6. QA: E2E con Playwright MCP (OBLIGATORIO si hay frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO)
- [x] 6.1 **No aplica**: este change es backend (sin UI de usuario nueva;
      la pestaña Comunicaciones y el envío manual son US-046). Justificación
      documentada en el report de step-N+2.

## 7. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4)
- [x] 7.1 Documentar el motor de email, el catálogo de plantillas e i18n, el modo
      sandbox y las variables de entorno nuevas (slice de `docs/` que toca M10):
      `architecture.md` §2.3 + §2.10 nuevos; `backend-standards.md` tabla módulos.
- [x] 7.2 Registrar la **deuda por US** del cableado E2–E8 (cada E con su US) y el
      cierre de DT-EMAIL-01: DT-EMAIL-01 marcada RESUELTA en `architecture.md` §2.9;
      DT-EMAIL-02 añadida en §2.9 con mapa E2→US-014, E3→US-021/022/023,
      E4→US-027/028, E5→US-034, E6→US-008, E7→US-009, E8→US-035; adjuntos PDF,
      recordatorios y US-046 documentados como diferidos.
- [x] 7.3 Reflejar la nueva capability `comunicaciones` y la migración del índice:
      `data-model.md` §3.16 + §5 con índice UNIQUE parcial (migración
      `20260628120000_us045_comunicacion_idempotencia_indice`);
      `er-diagram.md` §3.16 + §4.1 con mismo índice.

## 8. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)
- [x] 8.1 Ejecutar `code-reviewer` sobre el diff (hexagonal: sin proveedor en
      dominio; sin locks distribuidos; regresión cero US-003/004; contrato del puerto
      estable)
- [x] 8.2 Dejar informe `…/reports/YYYY-MM-DD-step-review-code-review.md` con
      `Veredicto: APTO`

## 9. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final — PARADA)
- [x] 9.1 Tras code-review APTO + validación manual, ESPERAR el OK humano antes de
      archive/PR

## 10. Archivar change + abrir PR (OBLIGATORIO — archive)
- [x] 10.1 `openspec archive us-045-motor-email-automatico` (solo tras gate final y
      code-review APTO) y abrir PR
