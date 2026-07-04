# Tasks — us-025-cumplimentar-ficha-operativa-evento

> Fuente de verdad de los pasos obligatorios: `openspec/config.yaml` y
> `docs/openspec-tasks-mandatory-steps.md`. El agente DEBE ejecutar él mismo todas las
> pruebas (unit, curl, E2E); **nunca** las delega en el usuario. Cada tarea se marca `[x]`
> solo tras ejecutarla y verificarla.

## 0. Setup: crear feature branch (OBLIGATORIO — step-0 — PRIMER PASO)

- [x] 0.1 Crear branch `feature/us-025-cumplimentar-ficha-operativa-evento` desde `master`
- [x] 0.2 Verificar la branch actual (`git branch --show-current`) — ya creada y activa

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd — PARADA)

- [x] 1.1 Gate SDD APROBADO — D-2/D-3/D-4/D-5/D-6 confirmadas

## 2. Contrato OpenAPI (tras el gate SDD)

- [x] 2.1 `contract-engineer`: definir en `docs/api-spec.yml` los endpoints anidados de la
      ficha operativa (ver `design.md §D-5`): `GET /reservas/{reservaId}/ficha-operativa`
      (leer o cuerpo "no disponible"), `PATCH /reservas/{reservaId}/ficha-operativa`
      (guardado parcial + edición post-cierre), `POST
      /reservas/{reservaId}/ficha-operativa/cerrar` (cierre con `avisosCamposVacios`). Fijar
      status del "no disponible por estado" y el schema del aviso informativo (no error)
- [x] 2.2 Validar el contrato (`spectral lint docs/api-spec.yml`) y regenerar el SDK del
      frontend (nunca editar el cliente generado a mano)

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first)

- [x] 3.1 Máquina de estados de `pre_evento_status` (dominio puro): transiciones válidas
      `pendiente → en_curso`, `en_curso → cerrado`; edición cerrada no reabre (`cerrado`
      estable); transición inválida rechazada — módulo REAL `ficha-evento` (no `ficha-operativa`):
      `apps/api/src/ficha-evento/domain/__tests__/maquina-estados-pre-evento.spec.ts`
- [x] 3.2 Guarda "primer guardado con datos" (dominio puro): un campo con dato dispara
      `pendiente → en_curso`; guardado totalmente vacío no dispara; ya en `en_curso` no
      reevalúa — mismo spec de dominio (`tieneAlgunDatoDeContenido`)
- [x] 3.3 Guarda de acceso por `RESERVA.estado` (use-case): `pre_reserva` → respuesta
      "no disponible" sin entidad; `reserva_confirmada`/`evento_en_curso`/`post_evento` →
      accesible; otra tenant → no accesible —
      `apps/api/src/ficha-evento/__tests__/leer-ficha-operativa.use-case.spec.ts`
- [x] 3.4 Guardado parcial (use-case): persiste solo el subconjunto enviado; `AUDIT_LOG`;
      primer guardado con datos deja `pre_evento_status = en_curso` (BD) —
      `apps/api/src/ficha-evento/__tests__/guardar-ficha-operativa.use-case.spec.ts`
- [x] 3.5 Cierre no bloqueado por campos vacíos (use-case): `ficha_cerrada = true`,
      `fecha_cierre = now()`, `pre_evento_status = cerrado`, `AUDIT_LOG`; con campos vacíos
      devuelve `avisosCamposVacios` y NO error —
      `apps/api/src/ficha-evento/__tests__/cerrar-ficha-operativa.use-case.spec.ts`
- [x] 3.6 Edición post-cierre (use-case): persiste el cambio, actualiza `fecha_cierre = now()`,
      `pre_evento_status` permanece `cerrado`, `AUDIT_LOG` — `guardar-ficha-operativa.use-case.spec.ts`
- [x] 3.7 Confirmar que TODA la batería anterior está en ROJO antes de implementar
      (por AUSENCIA DE IMPLEMENTACIÓN), 0 tests verdes — verificado: 4 suites FAILED (TS2307
      "Cannot find module"), 0 tests de la batería US-025 en verde

## 4. Backend: implementar + revisar/actualizar tests unitarios existentes (OBLIGATORIO — step-N)

- [x] 4.1 Verificar el modelo: `FichaOperativa` (schema.prisma ~L489) y enum `PreEventoStatus`
      (L72–76, campo RESERVA L280) ya existen; confirmar que NO se requiere migración
- [x] 4.2 `backend-developer`: máquina de estados de `pre_evento_status` como estructura de
      datos con guardas en dominio puro (`ficha-operativa/domain/**`), use-cases
      `LeerFichaOperativa` / `GuardarFichaOperativa` (guardado parcial + disparo `pendiente →
      en_curso` + edición post-cierre que actualiza `fecha_cierre`) / `CerrarFichaOperativa`
      (cierre no bloqueante + `avisosCamposVacios` + `en_curso → cerrado` + AUDIT_LOG), guarda
      de acceso por `RESERVA.estado`, filtrado por `tenant_id`/RLS; puertos en dominio,
      adaptadores Prisma en infraestructura, controlador en interface, en
      `apps/api/src/ficha-operativa/**`
- [x] 4.3 `frontend-developer`: en `apps/web/src/features/ficha-operativa/**`, formulario con
      los 7 campos, indicador de estado, botón "Cerrar ficha" (confirmación + aviso de campos
      vacíos), fecha de cierre + edición post-cierre, y mensaje contextual cuando la reserva no
      está confirmada; mobile-first (390/768/1280)
- [x] 4.4 Ejecutar §3 hasta verde; `pnpm lint`, `pnpm typecheck`, `pnpm test` y el chequeo
      hexagonal (imports de infra en `domain/` bloqueados) sin violaciones

## 5. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)

- [x] 5.1 Capturar baseline de BD (FICHA_OPERATIVA, RESERVA.pre_evento_status, AUDIT_LOG) en
      `slotify_test`
- [x] 5.2 Ejecutar tests dirigidos del módulo `ficha-operativa`
- [x] 5.3 Ejecutar la suite requerida (`pnpm test`) y registrar totales/flaky
- [x] 5.4 Verificar estado posterior de BD y restaurar si hace falta
- [x] 5.5 Crear report `openspec/changes/us-025-cumplimentar-ficha-operativa-evento/reports/YYYY-MM-DD-step-N+1-unit-test-and-db-verification.md`
- [x] 5.6 Marcar completado solo tras tests en verde y report creado

## 6. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)

- [x] 6.1 Levantar el backend y verificar conexión a BD
- [x] 6.2 `GET` de la ficha de una reserva confirmada: verificar campos, `ficha_cerrada=false`,
      `fecha_cierre=null`, `pre_evento_status`
- [x] 6.3 `PATCH` guardado parcial: verificar persistencia del subconjunto y que
      `pre_evento_status` pasa a `en_curso` en el primer guardado con datos. **Restaurar BD**
- [x] 6.4 `POST .../cerrar` con campos vacíos: verificar `ficha_cerrada=true`,
      `fecha_cierre`, `pre_evento_status=cerrado` y `avisosCamposVacios` (no error).
      **Restaurar BD**
- [x] 6.5 `PATCH` edición post-cierre: verificar persistencia, `fecha_cierre` actualizada y
      `pre_evento_status` sigue `cerrado`. **Restaurar BD**
- [x] 6.6 Casos de error: reserva en `pre_reserva` (respuesta "no disponible" sin entidad),
      reserva inexistente (`404`), otra tenant (no accesible), sin auth (`401`); verificar que
      el formato coincide con el contrato OpenAPI
- [x] 6.7 Crear report `.../reports/YYYY-MM-DD-step-N+2-curl-endpoint-tests.md`
- [x] 6.8 Marcar completado solo tras pasar todos los curl y restaurar la BD

## 7. QA: E2E con Playwright MCP (OBLIGATORIO — step-N+3 — hay frontend — EL AGENTE DEBE EJECUTARLO)

- [x] 7.1 Levantar frontend y backend con BD en estado conocido
- [x] 7.2 `browser_navigate` a la ficha de una reserva confirmada; snapshot inicial
- [x] 7.3 Flujo completo: cumplimentar campos y guardar (estado `en_curso`), cerrar la ficha
      (aviso de campos vacíos + estado `cerrado` + fecha de cierre), editar tras el cierre
      (persiste, estado sigue `cerrado`)
- [x] 7.4 Escenario reserva en `pre_reserva`: verificar el mensaje contextual en lugar del
      formulario; responsive verificado en 3 viewports (390/768/1280)
- [x] 7.5 Verificar persistencia (UI ↔ BD) y restaurar entorno/BD
- [x] 7.6 Crear report `.../reports/YYYY-MM-DD-step-N+3-e2e-playwright.md`

## 8. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4)

- [x] 8.1 `docs-keeper`: reflejar el flujo (cumplimentar → `en_curso`, cerrar → `cerrado`,
      editar tras cierre) y las transiciones de `pre_evento_status` en la doc técnica; verificar
      alineación US-025 ↔ OpenAPI ↔ `er-diagram.md` (§3.14 FICHA_OPERATIVA, §RESERVA
      `pre_evento_status`) ↔ UC-20 ↔ Módulo M7; anotar que `cerrado` es precondición de US-031

## 9. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)

- [x] 9.1 `code-reviewer` sobre el diff contra guardrails (hexagonal, máquina de estados como
      estructura de datos, dominio puro, multi-tenancy/RLS, cierre no bloqueante, edición
      post-cierre sin reabrir estado, AUDIT_LOG, mobile-first)
- [x] 9.2 Dejar informe `.../reports/YYYY-MM-DD-step-review-code-review.md` con la línea
      literal `Veredicto: APTO` (si NO APTO, volver a implementación y repetir)

## 10. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final — PARADA)

- [ ] 10.1 Tras code-review APTO + validación manual, **ESPERAR el OK humano** antes de
      archive/PR

## 11. Archivar change + abrir PR (OBLIGATORIO — archive)

- [ ] 11.1 `openspec archive us-025-cumplimentar-ficha-operativa-evento` (aplica el delta a
      `openspec/specs/ficha-operativa/`)
- [ ] 11.2 Abrir PR (GitHub MCP o `gh`) — solo tras el gate final y con code-review APTO
      (el hook `require-code-review` lo bloquea si falta el informe APTO)
- [ ] 11.3 Registrar la URL del PR en el frontmatter de
      `user-stories/US-025-cumplimentar-ficha-operativa-evento.md`
