# Step N+3 — E2E con Playwright MCP

**Change**: `2026-07-20-ajustes-ui-sidebar-toasts`
**Fecha**: 2026-07-20
**Entorno**: API `http://localhost:3000` + Web `http://localhost:5173` (dev),
Postgres dev seedeado (tenant piloto). Login: `info@masialencis.com`.
**Nota de arranque**: la API tenía un typo pre-existente en `apps/api/.env`
(`EMAIL_TRANSPORT=fakse`); se arrancó con override `EMAIL_TRANSPORT=fake` sin
tocar el `.env`. No afecta a este change (deuda ajena).

## Cambio 1 — Ancho del sidebar 12rem en 3 viewports

Medición del `<aside id="app-shell-sidebar">` con
`getBoundingClientRect()` y comprobación de overflow horizontal
(`documentElement.scrollWidth > clientWidth`):

| Viewport | Estado sidebar | Ancho `<aside>` | `aria-hidden` | Overflow horizontal |
|----------|----------------|-----------------|---------------|---------------------|
| **1280** (escritorio) | Abierto | **192px = 12rem** ✅ | `false` | **No** ✅ |
| **768** (tablet) | Colapsado | **0px** ✅ | `true` (+`inert`) | **No** ✅ |
| **390** (móvil) | Colapsado | **0px** ✅ | `true` | **No** ✅ |

- En escritorio el `<div>` interior también mide 192px (casa con el `<aside>`).
- El corte mobile↔desktop (`lg` = 1024) y el colapso a `w-0` en `<lg` se
  conservan; el cambio `w-72 → w-48` solo afecta al estado **abierto**.

Capturas:
- `e2e-screenshots/sidebar-1280-desktop.png` (abierto, 12rem, marca + nav + card
  de usuario + logout).
- `e2e-screenshots/sidebar-768-tablet-collapsed.png` (colapsado).
- `e2e-screenshots/sidebar-390-mobile-collapsed.png` (colapsado).

## Cambio 2 — Solo el último toast permanece a cada acción

Verificación en runtime real (mismo singleton de `sonner` que usa el `<Toaster/>`
montado): se cargó el módulo real `@/lib/notify` en la página y se emitieron 3
toasts simulando 3 acciones separadas en el tiempo (500ms entre sí):

```
notify.success('Accion 1: guardado')   → 500ms →
notify.warning('Accion 2: aviso')      → 500ms →
notify.error('Accion 3 (ultimo)...')
```

Resultado (conteo de `[data-sonner-toast]` en el DOM):

```
visibleCount: 1
texts: ["Accion 3 (ultimo): solo este queda visible"]
```

**Solo queda el último mensaje** ✅. Confirmado también con una secuencia previa
sin duración prolongada (success → warning → error): `visibleCount: 1`, único
texto "Tercer y ultimo mensaje".

Captura: `e2e-screenshots/toast-solo-el-ultimo-1280.png` (un único toast
bottom-right).

**Nota técnica**: si los 3 toasts se disparan en el **mismo tick síncrono**
(caso irreal para acciones de usuario), sonner puede dejar el penúltimo en
animación de salida un instante (contado transitoriamente como 2). Con acciones
separadas en el tiempo —el escenario real— el resultado es siempre 1, tal como
exige el requisito. La conducta determinista (`toast.dismiss()` antes de emitir)
está además cubierta por el unit test `src/lib/__tests__/notify.test.ts`.

## Conclusión

Ambos cambios verificados end-to-end contra la app real. Cubre el punto Medio del
code-review (evidencia responsive en 390/768/1280). Sin errores de consola
relevantes; sin overflow horizontal en ningún viewport.
