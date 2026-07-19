# Code review — mejoras-detalle-consulta

Revisor: code-reviewer (solo lectura). Base: `master` (f82dc8f) vs trabajo del worktree
`worktree-mejoras-detalle-consulta`. El trabajo del change está TODO sin commitear en el
árbol de trabajo; el diff efectivo se revisa sobre `git diff` (working tree), no sobre
`master...HEAD` (HEAD == merge-base, ver hallazgo A-1).

## Alcance revisado (36 ficheros, +323/-29)
1. Invitados (frontend): `DetallesEvento.tsx` una sola fila "Invitados".
2. Comentarios (backend + contrato + SDK + frontend): columna `RESERVA.comentarios`
   aditiva, expuesta solo en `ReservaDetalle`, sembrada en `notasOperativas` al crear la
   ficha operativa en la confirmación de señal (US-021).
3. Envío manual E1 (frontend): invalidación de `reservaQueryKey` + banner `AvisoEmailEnviado`.

---

## Hallazgos por severidad

### Bloqueante
Ninguno.

### Alta
- **A-1 — La rama está 3 commits por detrás de `master`; riesgo de revertir PR #85 al mergear.**
  Ubicación: estado del worktree (HEAD `6ff9bc4` == merge-base; `master` `f82dc8f`).
  Regla: integridad de merge / no perder trabajo ajeno.
  Detalle: el trabajo del change está sin commitear. `master` avanzó con
  `feature/layout-appshell-ancho-titulos-sidebar` (PR #85: `App.tsx`, `AppShell.tsx`,
  `SectionPlaceholder.tsx`, `openspec/specs/app-shell/spec.md`, tests de layout, etc.).
  Un `git diff master` de dos puntos muestra esos ficheros como borrados/revertidos.
  Si se comitea y mergea sin rebasar/actualizar contra `master`, se REVIERTE PR #85.
  Recomendación: antes de commit/PR, actualizar la rama con `master`
  (rebase o merge), confirmar que el diff final NO toca ningún fichero de app-shell/layout
  y re-ejecutar typecheck + lint + tests tras la integración. Los ficheros del change
  son solo los que aparecen en `git status` como modificados/no rastreados de reservas,
  confirmacion, comunicaciones, contrato/SDK y docs del change; NADA de app-shell.

### Media
- **M-1 — `notasOperativas` en la ficha operativa puede quedar desincronizada con
  `RESERVA.comentarios` si estos se editan después.** (deuda de diseño, aceptable)
  Ubicación: `apps/api/src/confirmacion/application/confirmar-pago-senal.use-case.ts:490-501`.
  Detalle: la siembra es una COPIA one-shot al crear la ficha; correcto y deseado
  (las notas operativas son editables por el gestor y no deben pisarse). No es un defecto,
  pero conviene que quede documentado en el design del change para evitar sorpresas.
  Recomendación: confirmar en `design.md` que la siembra es intencionadamente one-shot
  (ya cubierta por el test de idempotencia). Sin cambio de código.

### Baja
- **B-1 — Refresco de descripción de `CreateReservaRequest.comentarios` en SDK/spec.**
  Ubicación: `apps/web/src/api-client/schema.d.ts` (línea CreateReservaRequest) y
  `docs/api-spec.yml:4772+`. Es un cambio de texto de documentación arrastrado por la
  regeneración del SDK; coincide con el contrato. No es edición manual del cliente
  (cabecera generada intacta, cambio consistente spec↔SDK). Sin acción.

---

## Verificación de guardrails (checklist)

- **Hexagonal**: OK. `alta-consulta.use-case.ts` y `confirmar-pago-senal.use-case.ts`
  (capa application) NO importan `@nestjs/*`, `@prisma/*` ni `infrastructure/`. El puerto
  `FichaOperativaConfirmacionRepositoryPort.crearVacia` se extiende con `notasOperativas`
  en application; el adaptador lo implementa en `infrastructure/`.
- **Bloqueo atómico de fecha**: intacto. El change no toca `bloquearFecha/liberarFecha`
  ni introduce Redis/locks distribuidos. Migración puramente aditiva (`ADD COLUMN`).
- **Máquina de estados**: intacta. No hay `if/else` de transición nuevos; la decisión de
  E1 no cambia (tests de regresión lo confirman).
- **Multi-tenancy / RLS**: OK. `CargarReservaConfirmacionPrismaAdapter` usa
  `fijarTenant(tx, tenantId)` + filtro explícito `tenantId` en el WHERE (cross-tenant → null
  → 404). La siembra de `notasOperativas` ocurre DENTRO de la UoW transaccional scoped al
  tenant. La columna nueva no rompe RLS.
- **Atomicidad / idempotencia de la siembra**: OK. `crearVacia` incluye `notasOperativas`
  en el mismo `tx.fichaOperativa.create` (atómico). Solo se invoca si `fichaExistente === null`
  (idempotente); test de integración `no_debe_re_sembrar_ni_sobreescribir_...` verifica que
  una ficha preexistente NO se pisa y no se duplica.
- **Contrato como frontera**: OK y aditivo. `comentarios: string, nullable: true` añadido
  SOLO al `allOf` de `ReservaDetalle` (no al `Reserva` base). SDK regenerado, no editado a
  mano (cabecera/estructura generadas intactas). DTO `ReservaDetalleResponseDto` con
  `@ApiPropertyOptional({ nullable: true })`. Los controladores que devuelven el detalle
  (obtener, patch, cambiar-fecha, extender-bloqueo, programar-visita, registrar-visita,
  registrar-firma) proyectan `comentarios` de forma exhaustiva (forzado por el tipo).
- **Tipos y datos**: OK. Sin `any`. `comentarios` es `string | null`. Trim consistente
  en alta y en siembra (blanco → NULL/undefined). No aplica Decimal.
- **components/ solo .tsx**: OK. `AvisoEmailEnviado.tsx` es un componente React (arrow fn),
  sin helpers/tipos/constantes sueltos. Tests nuevos en `__tests__/`.
- **Arrow functions**: OK en todo el código nuevo (componentes, handlers, factories de test).
- **Boundaries entre features**: OK. `useEnviarBorrador` importa `reservaQueryKey` vía el
  barrel `@/features/reservas` (exportado en `index.ts:12`), no por ruta profunda. El
  callback `onEmailEnviado` se propaga por props desde la page; sin acoplamiento indebido.
- **Responsive**: OK a nivel de código. `AvisoEmailEnviado` usa flex + `rounded`/`gap`
  sin anchos px fijos; `DetallesEvento` conserva el grid `grid-cols-1 sm:grid-cols-2`.
  El change no toca el app-shell/sidebar. NOTA: no se aporta evidencia de 3 viewports
  para las pantallas tocadas en este informe; el QA report del change debe cubrirlo
  (o declarar que el cambio visual es menor: una fila menos y un banner).
- **max-lines ≤300**: OK. `FichaConsultaPage.tsx` es 316 líneas en bruto pero la regla
  usa `skipBlankLines`+`skipComments` (efectivo ~276). `pnpm lint` reportado exit 0.
- **Tests primero**: OK. Tests de integración reales (Postgres) para siembra
  (con/ sin/ idempotente) y exposición de `comentarios` (valor/null/independencia de
  `notas`); unit de alta con trim/blanco + regresión de decisión E1; frontend
  `DetallesEvento.test.tsx` (fila única, ausencia de "Niños ≤ 4"/"invitados final",
  comentarios≠notas, placeholder) y `RevisarEnviarBorradorDialog.test.tsx`. No enmascaran
  comportamiento: verifican efectos observables (BD, DOM), no solo llamadas mockeadas.
- **Convenciones español**: OK (nombres, comentarios y descripciones en español).

## Nota sobre suites en rojo (pre-existente, fuera de alcance)
`finalizar-evento-integracion.spec.ts` (`fakeEmail.forzarFallo is not a function`) es
pre-existente (idéntico a master, 0 líneas en el diff, falla en aislamiento). No es de
este change.

---

## Veredicto: APTO

Condición operativa antes de archivar/PR (no bloquea la calidad del código, pero es
obligatoria para no romper `master`): resolver **A-1** actualizando la rama contra
`master` y verificando que el diff final NO revierte PR #85 (app-shell/layout), con
re-ejecución de typecheck+lint+tests tras la integración.
