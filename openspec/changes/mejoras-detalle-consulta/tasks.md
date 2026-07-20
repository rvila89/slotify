# Tasks — mejoras-detalle-consulta

> Flujo del arnés SDD + TDD. El agente DEBE ejecutar él mismo todas las pruebas manuales
> (unit, curl, E2E); nunca las delega en el usuario. Marcar `[x]` solo tras ejecutar y
> verificar. Reports en `openspec/changes/mejoras-detalle-consulta/reports/`.
>
> Alcance: **Mejora 1** (detalle invitados, frontend puro), **Mejora 2** (persistir/exponer/
> sembrar `comentarios`, backend + contrato + frontend), **Mejora 3** (refresco de la ficha
> al enviar el borrador E1, frontend puro).

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)

- [x] 0.1 Trabajo en el **worktree aislado** `worktree-mejoras-detalle-consulta` (equivale a
  la feature branch `feature/mejoras-detalle-consulta`; Step 0 satisfecho por el worktree,
  no se crea rama nueva ni se hace checkout).
- [x] 0.2 Confirmada la branch activa del worktree antes de cualquier escritura.

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd)

- [ ] 1.1 Presentar al humano `proposal.md` + spec-delta (`consultas`, `confirmacion`,
  `comunicaciones`) + `design.md` y **ESPERAR su OK explícito** antes de avanzar a
  contrato/TDD/impl. **EL FLUJO SE DETIENE AQUÍ.**
- [ ] 1.2 Confirmar con el humano las decisiones abiertas del `design.md`: exponer
  `comentarios` **solo en `ReservaDetalle`** (§D-2.2) y sembrar `notasOperativas` sin campo
  nuevo en la ficha operativa (§D-2.3).

## 2. Contrato: exponer `comentarios` en el detalle (contract-engineer — tras el gate)

- [ ] 2.1 Añadir `comentarios` (`type: string, nullable: true`) al schema `ReservaDetalle`
  de `docs/api-spec.yml` (**solo** en el detalle; NO en el schema base `Reserva` ni en el
  listado/histórico).
- [ ] 2.2 Validar el contrato (`validate-openapi` / `spectral lint docs/api-spec.yml`) y
  **regenerar el SDK** del frontend (no editar el cliente generado a mano; hook
  `protect-generated-client`).

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first)

- [ ] 3.1 **Backend (Mejora 2 · persistencia)**: test en rojo de `AltaConsultaUseCase` — el
  alta persiste `comentarios` en la columna `RESERVA.comentarios` (con comentarios → valor;
  sin/blanco → `NULL`) **sin cambiar** la decisión de E1 (borrador vs. auto-envío).
- [ ] 3.2 **Backend (Mejora 2 · siembra)**: tests en rojo de `ConfirmarPagoSenalUseCase` —
  al crear la ficha operativa vacía, `notasOperativas` se siembra con `RESERVA.comentarios`
  si existe y no está en blanco; nace `NULL` si no; **idempotencia**: ficha ya existente no
  se duplica ni re-siembra; atomicidad y RLS por tenant intactas.
- [ ] 3.3 **Frontend (Mejora 1)**: test en rojo de `DetallesEvento` — una sola fila
  "Invitados" (`numAdultosNinosMayores4`); NO aparecen "Niños ≤ 4" ni "Nº de invitados
  final".
- [ ] 3.4 **Frontend (Mejora 2 · detalle)**: test en rojo — la fila "Comentarios" lee
  `reserva.comentarios` (no `notas`); placeholder si ausente.
- [ ] 3.5 **Frontend (Mejora 3)**: tests en rojo de `useEnviarBorrador` — `onSuccess`
  invalida también `reservaQueryKey`; y del aviso de éxito arriba + scroll al inicio tras el
  envío exitoso (patrón `AvisosResultado`).
- [ ] 3.6 Confirmar que la suite está en **rojo** por las razones esperadas antes de
  implementar (unit backend por columna/siembra ausente; unit web por comportamiento nuevo).

## 4. Backend: implementar + revisar/actualizar tests unitarios (OBLIGATORIO — step-N)

- [ ] 4.1 Migración aditiva `RESERVA.comentarios String? @db.Text` (Prisma) + regenerar
  cliente Prisma.
- [ ] 4.2 `AltaConsultaUseCase`: persistir `comentarios` (trim; vacío → `NULL`) en la
  transacción del alta, **sin** tocar la lógica de decisión de E1 (`tieneComentarios`).
- [ ] 4.3 `ConfirmarPagoSenalUseCase` + repositorio de ficha operativa
  (`FichaOperativaConfirmacionRepositoryPort.crearVacia` /
  `confirmar-pago-senal-uow.prisma.adapter.ts`): sembrar `notasOperativas` con
  `RESERVA.comentarios` en el mismo `create` (atómico, idempotente, RLS).
- [ ] 4.4 Revisar/actualizar tests unitarios existentes afectados (incl.
  `confirmar-pago-senal-integracion.spec.ts:286` → `notasOperativas` null solo sin
  comentarios); dejar la suite en verde. Dominio no importa de infra (hook
  `no-infra-in-domain`).

## 5. Frontend: implementar (OBLIGATORIO — step-N)

- [ ] 5.1 **Mejora 1**: `DetallesEvento.tsx` — una sola fila "Invitados"
  (`numAdultosNinosMayores4`); eliminar filas "Niños ≤ 4" y "Nº de invitados final". No
  tocar el modelo, el editor ni `lib/aforo.ts`.
- [ ] 5.2 **Mejora 2 (detalle)**: fila "Comentarios" ← `reserva.comentarios` (SDK
  regenerado); placeholder si ausente; solo lectura.
- [ ] 5.3 **Mejora 3**: `useEnviarBorrador` invalida también `reservaQueryKey(reservaId)` en
  `onSuccess`; aviso de éxito arriba de la ficha (patrón `AvisosResultado.tsx`) + scroll al
  inicio tras el envío exitoso.
- [ ] 5.4 Responsive verificado en el diseño (mobile-first; sin overflow; `lg:` como corte);
  arrow functions; `components/` solo `.tsx`.

## 6. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)

- [ ] 6.1 Capturar baseline de BD (RESERVA, FICHA_OPERATIVA, AUDIT_LOG del tenant de prueba).
- [ ] 6.2 Ejecutar tests dirigidos de los módulos cambiados (reservas: alta persiste
  `comentarios`; confirmación: siembra + idempotencia con Postgres real; web:
  `DetallesEvento`, `useEnviarBorrador`, aviso).
- [ ] 6.3 Ejecutar la suite requerida (`pnpm test`); documentar flaky pre-existentes ajenos
  (US-004 deadlock, react-pdf ESM) si aparecen.
- [ ] 6.4 Verificar estado posterior de BD y restaurar si hace falta.
- [ ] 6.5 Crear report `reports/YYYY-MM-DD-step-6-unit-test-and-db-verification.md`.
- [ ] 6.6 Marcar completado solo tras tests en verde y report creado.

## 7. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)

- [ ] 7.1 Levantar el backend y verificar conexión a BD.
- [ ] 7.2 `POST /reservas` (alta con `comentarios`) → 201 + `RESERVA.comentarios`
  persistido + E1 en `borrador`; restaurar BD.
- [ ] 7.3 `POST /reservas` (alta sin `comentarios`) → 201 + `comentarios = NULL` +
  auto-envío E1; restaurar BD.
- [ ] 7.4 `GET /reservas/{id}` → `ReservaDetalle` incluye `comentarios`; verificar que el
  listado (`GET /reservas`) NO lo incluye.
- [ ] 7.5 Confirmar pago de señal (`pre_reserva → reserva_confirmada`) de una reserva con
  `comentarios` → `FICHA_OPERATIVA.notas_operativas` sembrado; de una sin comentarios →
  `notas_operativas` NULL; idempotencia (reintento no re-siembra); restaurar BD.
- [ ] 7.6 Crear report `reports/YYYY-MM-DD-step-7-curl-endpoint-tests.md`.

## 8. QA: E2E con Playwright MCP (OBLIGATORIO — hay frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO)

- [ ] 8.1 Levantar frontend + backend, BD en estado conocido.
- [ ] 8.2 **Mejora 1**: abrir la ficha → una sola fila "Invitados"; no aparecen "Niños ≤ 4"
  ni "Nº de invitados final".
- [ ] 8.3 **Mejora 2**: la fila "Comentarios" muestra el `comentarios` del alta (no `notas`);
  y al abrir la ficha operativa tras confirmar la señal, el comentario aparece sembrado en
  `notasOperativas` y es editable.
- [ ] 8.4 **Mejora 3**: con un E1 en borrador, enviar el borrador desde la ficha → las
  acciones se desbloquean **sin recargar**, aparece el aviso de éxito arriba y la página hace
  scroll al inicio.
- [ ] 8.5 Verificado en 3 viewports (390 / 768 / 1280), sin overflow horizontal.
- [ ] 8.6 Entorno y BD restaurados; capturas en `reports/e2e-screenshots/`.
- [ ] 8.7 Crear report `reports/YYYY-MM-DD-step-8-e2e-playwright.md`.

## 9. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4)

- [ ] 9.1 Actualizar `docs/` afectada: `er-diagram`/`data-model` (`RESERVA.comentarios`;
  siembra de `FICHA_OPERATIVA.notas_operativas`), `use-cases` (UC-17/UC-20 siembra, UC-36
  refresco). `api-spec` lo actualiza el `contract-engineer`.

## 10. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)

- [ ] 10.1 Ejecutar `code-reviewer` sobre el diff (guardrails: hexagonal/dominio sin infra,
  bloqueo atómico no tocado, contrato/SDK generado, responsive 3 viewports, `max-lines`,
  arrow functions, `components/` solo `.tsx`).
- [ ] 10.2 Informe `reports/YYYY-MM-DD-step-review-code-review.md` con línea literal
  `Veredicto: APTO` (el hook `require-code-review` lo exige para archivar/PR).

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final)

- [ ] 11.1 Tras code-review APTO + validación manual, **ESPERAR el OK humano** antes de
  archive/PR. **EL FLUJO SE DETIENE AQUÍ.**

## 12. Archivar change + abrir PR (OBLIGATORIO — archive)

- [ ] 12.1 `openspec archive mejoras-detalle-consulta` (aplica: MODIFIED `consultas` x1 +
  ADDED `consultas` x1, MODIFIED `confirmacion` x1, ADDED `comunicaciones` x1).
- [ ] 12.2 Verificar `openspec/specs/` actualizado por `archive`; abrir PR contra `master`
  (GitHub MCP o `gh`).
