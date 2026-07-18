# Tasks — us-051-ficha-consulta-ver-editar-acciones

> Flujo del arnés SDD + TDD. El agente DEBE ejecutar él mismo todas las pruebas manuales
> (unit, curl, E2E); nunca las delega en el usuario. Marcar `[x]` solo tras ejecutar y
> verificar. Reports en `openspec/changes/us-051-ficha-consulta-ver-editar-acciones/reports/`.

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0) ✅

- [x] 0.1 Crear branch `feature/us-051-ficha-consulta-ver-editar-acciones` desde `master`
  (actualizado) — HECHO por `spec-author`.
- [x] 0.2 Verificar la branch creada y activa.

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd) ← EL FLUJO ESTÁ AQUÍ

- [ ] 1.1 Presentar al humano `proposal.md` + spec-delta (`consultas`, `presupuestos`) +
  `design.md` y **ESPERAR su OK explícito** antes de avanzar a contrato/TDD/impl.
- [ ] 1.2 Confirmar con el humano la **decisión de alcance de fecha** (`design.md §D-2.3`):
  ¿se incluye la operación atómica "cambiar fecha ya bloqueada" o se difiere dejando la
  fecha editable solo en `2a`? La respuesta condiciona el TDD de concurrencia y la
  spec-delta de `consultas`.

## 2. Contrato: exponer `horario` y validar (contract-engineer — tras el gate)

- [x] 2.1 Añadir `horario` (`pattern ^\d{2}:\d{2}$`, nullable) al schema `Reserva` en
  `docs/api-spec.yml`.
- [x] 2.2 Añadir `horario` (`pattern ^\d{2}:\d{2}$`) a `UpdateReservaRequest`.
- [x] 2.4 (Gate CONFIRMÓ §D-2.3) Añadir el endpoint dedicado `POST /reservas/{id}/cambiar-fecha`
  (schema `CambiarFechaRequest` = `{ fechaEvento }`, sin `aceptarCola`; `409`
  `CambiarFechaConflictoError` = `ErrorResponse` + `motivo`, sin `colaDisponible`; `422`
  ValidationError; `404` NotFound). NO reutiliza `POST /reservas/{id}/fecha` (§D-2.1).
- [x] 2.3 Validar el contrato (`validate-openapi`) y **regenerar el SDK** del frontend (no
  editar el cliente generado a mano; hook `protect-generated-client`).

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first)

- [ ] 3.1 **Concurrencia (mayor riesgo)**: tests en rojo de la operación atómica "cambiar
  fecha ya bloqueada" (patrón `atomic-date-lock` / `concurrency-locking`), SOLO si el gate
  la incluye (§D-2.3): dos cambios concurrentes a la misma fecha nueva (uno gana),
  anti-doble-reserva D4, promoción FIFO al liberar fecha con cola, rollback total si la
  fecha nueva está ocupada.
- [ ] 3.2 Backend `ActualizarReservaUseCase` (PATCH campos simples): persiste campos, NO
  muta `fechaEvento`/`FECHA_BLOQUEADA`, no cambia estado/sub-estado, escribe AUDIT_LOG,
  RLS por tenant; validación cruzada `horario` requiere `duracionHoras`.
- [ ] 3.3 Frontend: gate de completitud de "Generar presupuesto" (fecha + invitados +
  duración + horario) y saneo de acciones en terminales (`2x/2y/2z`, `reserva_cancelada`,
  `reserva_completada` → solo fallback).
- [ ] 3.4 Confirmar que la suite está en **rojo** por las razones esperadas antes de
  implementar.

## 4. Backend: implementar + revisar/actualizar tests unitarios (OBLIGATORIO — step-N)

- [ ] 4.1 `PatchReservaController` + `ActualizarReservaUseCase` (patrón de
  `actualizar-datos-fiscales-cliente.controller.ts`): RLS por tenant, AUDIT_LOG, sin tocar
  fecha/bloqueo.
- [ ] 4.2 (Si el gate lo incluye) Operación atómica "cambiar fecha" bajo `bloquearFecha`/
  `liberarFecha` con `SELECT … FOR UPDATE` + manejo de cola (promoción FIFO).
- [ ] 4.3 Revisar/actualizar tests unitarios existentes afectados; dejar la suite en verde.

## 5. Frontend: implementar (OBLIGATORIO — step-N)

- [ ] 5.1 Ficha: sección con **todos** los datos del evento (duración, invitados, horario,
  notas) + placeholder para opcionales ausentes.
- [ ] 5.2 Editor de consulta (formulario TanStack): campos simples vía `PATCH /reservas/{id}`;
  asignar/cambiar fecha por el flujo atómico (§D-2), nunca por el PATCH.
- [ ] 5.3 Gate de completitud de "Generar presupuesto" + enumeración de lo que falta +
  sugerencia "Editar consulta".
- [ ] 5.4 Saneo de acciones en terminales (`AccionesConsulta`, `AccionPresupuesto`,
  `AccionDescartar`): solo fallback "No hay acciones disponibles".

## 6. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)

- [ ] 6.1 Capturar baseline de BD (RESERVA, FECHA_BLOQUEADA, AUDIT_LOG del tenant de prueba).
- [ ] 6.2 Ejecutar tests dirigidos de los módulos cambiados (incluida concurrencia si aplica).
- [ ] 6.3 Ejecutar la suite requerida (`pnpm test`).
- [ ] 6.4 Verificar estado posterior de BD y restaurar si hace falta.
- [ ] 6.5 Crear report `reports/YYYY-MM-DD-step-N+1-unit-test-and-db-verification.md`.
- [ ] 6.6 Marcar completado solo tras tests en verde y report creado.

## 7. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)

- [ ] 7.1 Levantar el backend y verificar conexión a BD.
- [ ] 7.2 `PATCH /reservas/{id}` — editar campos simples; verificar 200 + persistencia +
  AUDIT_LOG; **restaurar la RESERVA a sus valores originales**.
- [ ] 7.3 `PATCH /reservas/{id}` — `horario` sin `duracionHoras` → error de validación
  (400/422); verificar que NO persiste.
- [ ] 7.4 (Si el gate lo incluye) Cambio de fecha bloqueada → verificar liberación/bloqueo
  atómicos y AUDIT_LOG; **restaurar bloqueo y fecha**.
- [ ] 7.5 Casos de error: 404 reserva inexistente, acceso cross-tenant (RLS).
- [ ] 7.6 Crear report `reports/YYYY-MM-DD-step-N+2-curl-endpoint-tests.md`.

## 8. QA: E2E con Playwright MCP (OBLIGATORIO — hay frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO)

- [ ] 8.1 Levantar frontend + backend, BD en estado conocido.
- [ ] 8.2 Abrir la ficha: verificar que muestra todos los datos del evento y los
  placeholders de los ausentes.
- [ ] 8.3 Editar la consulta (p. ej. invitados 30 → 20) y verificar persistencia en UI + BD.
- [ ] 8.4 Gate de presupuesto: con datos incompletos, botón deshabilitado + lista de lo que
  falta; completar por el editor y verificar que se habilita.
- [ ] 8.5 Consulta terminal (`2z`/cancelada): verificar que NO aparece ninguna acción, solo
  el fallback.
- [ ] 8.6 Verificar en 3 viewports (390 / 768 / 1280) — responsive obligatorio.
- [ ] 8.7 Restaurar entorno y estado de BD; mover capturas a `reports/e2e-screenshots/`.
- [ ] 8.8 Crear report `reports/YYYY-MM-DD-step-N+3-e2e-playwright.md`.

## 9. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4)

- [ ] 9.1 Actualizar `docs/` afectada (`er-diagram` si procede, `use-cases`, notas de
  contrato) y las specs de referencia que cite la implementación.

## 10. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)

- [ ] 10.1 Ejecutar `code-reviewer` sobre el diff (guardrails: hexagonal, bloqueo atómico
  sin locks distribuidos, contrato/SDK, responsive, `max-lines`, arrow functions).
- [ ] 10.2 Dejar informe `reports/YYYY-MM-DD-step-review-code-review.md` con la línea
  `Veredicto: APTO`. Si `NO APTO`, volver a implementación y repetir.

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final)

- [ ] 11.1 Tras code-review APTO + validación manual, **ESPERAR el OK humano** antes de
  archive/PR.

## 12. Archivar change + abrir PR (OBLIGATORIO — archive)

- [ ] 12.1 `openspec archive us-051-ficha-consulta-ver-editar-acciones` (solo tras gate
  final y code-review APTO; el hook `require-code-review` lo bloquea si falta el informe).
- [ ] 12.2 Actualizar `openspec/specs/` (lo aplica `archive`) y abrir PR.
