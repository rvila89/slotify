# Informe de revisión — `2026-07-20-ajustes-ui-sidebar-toasts`

**Rama**: `feature/2026-07-20-ajustes-ui-sidebar-toasts`
**Alcance**: 100% frontend (`apps/web`). Sin backend, dominio, contrato ni BD.
**Base de comparación**: `git diff master` (working tree, sin commitear).
**Fecha**: 2026-07-20

## Ámbito revisado
- `apps/web/src/components/layout/AppShell.tsx` — sidebar `w-72` → `w-48` (2 clases + docstring + 2 comentarios).
- `apps/web/src/lib/notify.ts` (nuevo) + `apps/web/src/lib/__tests__/notify.test.ts` (nuevo).
- 9 ficheros de features migrados de `toast.*()` a `notify.*()`.
- 2 mocks de sonner en tests con `dismiss: vi.fn()` añadido.

## Guardrails de arquitectura backend
- **N/A**: change 100% frontend. No toca `domain/`, `infrastructure/`, Prisma, bloqueo de fecha, RLS, jobs, importes ni el SDK/cliente generado. Sin hallazgos.

## Bloqueantes
- Ninguno.

## Altas
- Ninguna.

## Medias
- **[responsive/evidencia]** El checklist exige evidencia en 3 viewports (390/768/1280) para cambios de UI. Los reports cubren lint/typecheck/unit y justifican N/A en curl, pero no aportan capturas ni E2E Playwright en los 3 viewports. El código es correcto y el riesgo es bajo (el cambio de ancho solo aplica en `≥lg` y no altera el comportamiento `<lg`). Recomendación: adjuntar E2E/capturas en 390/768/1280 antes de archivar, o dejar constancia de renuncia justificada.

## Bajas
- **[documentación proposal]** El `proposal.md` decía "~24 call-sites (12 ficheros)" migrados, mientras el diff real migra 9 ficheros de producción (+2 tests). Imprecisión de conteo, no defecto de código. **Corregido** en el proposal tras la revisión.

## OK (verificado sin hallazgos)
- **Migración `toast` → `notify` completa.** No queda ningún `toast.*()` directo en producción; el único uso restante está en `toaster-montado.test.tsx` (test de regresión del montaje del `<Toaster/>`, legítimo). Imports `from 'sonner'` restantes correctos: `lib/notify.ts` (wrapper), `components/ui/sonner.tsx` (config, sin cambios) y ficheros de test.
- **Arrow functions** (regla dura ESLint): `notify.ts` y `notify.test.ts` usan arrows; sin `function` declarativa. Conforme.
- **`components/` solo `.tsx`**: el helper vive en `lib/`, no bajo `features/*/components/`. Conforme.
- **Boundaries**: `lib/` compartido no importa de `features/`; las features consumen `@/lib/notify` (feature → shared, permitido). Conforme.
- **Determinismo**: `soloUltimo` invoca `toast.dismiss()` antes de emitir; el test lo verifica por `invocationCallOrder` para las 4 variantes. No depende de `visibleToasts`.
- **Preservación de tipo/opciones**: `Parameters<F>`/`ReturnType<F>` por método; mensaje, `{ description }` y retorno se reenvían intactos. TS strict, sin `any`.
- **Responsive del sidebar (código)**: conserva colapso a `w-0` en `<lg`, `inert`+`aria-hidden`, estado inicial por viewport y toggle. El cambio afecta solo al estado abierto; sin overflow nuevo.
- **Convenciones en español** en identificadores, docstrings y mensajes.
- **Tests primero**: `notify.test.ts` con RED confirmado antes de crear el módulo; mocks de sonner actualizados. Suite verde (60 files / 362 tests).
- **Contrato / cliente generado**: sin cambios.

## Veredicto

Ningún hallazgo Bloqueante ni Alto. El punto Medio (evidencia en 3 viewports) es recomendación de QA, no defecto de código. El hallazgo Bajo (conteo del proposal) queda corregido.

**Veredicto: APTO**
