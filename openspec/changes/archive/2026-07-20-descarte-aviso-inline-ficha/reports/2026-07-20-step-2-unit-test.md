# Step 2 — Unit tests + lint
**Change:** `2026-07-20-descarte-aviso-inline-ficha`
**Fecha:** 2026-07-20
**Ejecutado desde:** `apps/web` del worktree `descarte-aviso-inline-ficha`

---

## Comandos ejecutados

```
cd C:\Users\roger.vila\Documents\SLOTIFY\.claude\worktrees\descarte-aviso-inline-ficha\apps\web

pnpm lint
pnpm test
```

---

## pnpm lint

**Exit code:** 0 (VERDE)

**Salida relevante:**

```
$ eslint . --max-warnings 0
[boundaries][warning]: Rule "boundaries/entry-point" is deprecated ...
[boundaries][warning]: Rule name "boundaries/element-types" is deprecated ...
```

Solo se emitieron 4 advertencias de deprecación de `eslint-plugin-boundaries` (migración de selectores a v6). Estas warnings son pre-existentes en todo el proyecto y aceptables. No hubo errores de lint ni violaciones de reglas duras (arrow functions, `components/` solo `.tsx`, `max-lines` ≤300, boundaries de features).

---

## pnpm test (Vitest)

**Exit code:** 0 (VERDE)

### Conteo global

| Resultado | Valor |
|-----------|-------|
| Test files | **61 passed** (61) |
| Tests | **362 passed** (362) |
| Duración | 182.91s |

### Suites específicas del change

| Suite | Tests | Estado |
|-------|-------|--------|
| `AvisoDescarte.test.tsx` | 4 | PASSED |
| `DescartarPreReservaDialog.test.tsx` | 1 | PASSED |
| `DescartarConsultaDialog.test.tsx` | 1 | PASSED |
| `toaster-montado.test.tsx` (regresión) | 1 | PASSED |

**Detalle de las suites del change:**

- `AvisoDescarte` — 4 tests: renderiza banner verde con `tipo='consulta'`, con `tipo='prereserva'`, muestra el código en ambos casos, botón cerrar invoca `onCerrar`. Todos PASSED.
- `DescartarPreReservaDialog` — 1 test: al confirmar con éxito NO emite `toast.success` y notifica `onDescartado`. PASSED.
- `DescartarConsultaDialog` — 1 test: al confirmar con éxito NO emite `toast.success` y notifica `onDescartado`. PASSED.
- `toaster-montado` (regresión) — 1 test: `<Toaster/>` de Sonner sigue montado en App; otros dominios que usan toast no se ven afectados. PASSED.

---

## Estado de BD

No aplica. Este change es exclusivamente frontend (`apps/web`). No hay mutaciones de BD.

---

## Veredicto

**PASS** — lint exit 0 (solo warnings pre-existentes de `eslint-plugin-boundaries`) y suite completa verde: 61 archivos / 362 tests, sin regresiones.
