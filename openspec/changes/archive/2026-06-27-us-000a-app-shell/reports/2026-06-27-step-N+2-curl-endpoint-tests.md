# Step N+2 — Curl Endpoint Tests
**Change:** us-000a-app-shell
**Fecha:** 2026-06-27
**Ejecutado por:** qa-verifier

---

## Resultado: N/A — Sin endpoints nuevos

Este change es **frontend-only**. US-000A no introduce ni modifica ningún endpoint del backend (`apps/api`).

### Justificación de alcance

Los artefactos entregados por US-000A son exclusivamente de `apps/web`:

| Archivo | Tipo |
|---|---|
| `src/auth/session.tsx` | Contexto React en memoria (no HTTP) |
| `src/app/RequireAuth.tsx` | Guard de ruta React Router |
| `src/app/AppShell.tsx` | Layout React con nav + outlet |
| `src/app/SectionPlaceholder.tsx` | Componente de presentación |
| `src/app/NotFound.tsx` | Componente de presentación |
| `src/App.tsx` | Árbol de rutas (modificado) |
| `src/index.css` | Design tokens CSS |
| `tailwind.config.ts` | Configuración Tailwind |
| `components.json` | Config shadcn/ui |
| `src/lib/utils.ts` | Helper `cn` |

Ninguno de estos artefactos define, modifica ni consume endpoints REST. El `SessionProvider` gestiona estado en memoria React. El `LoginPage` es un stub sin llamadas HTTP (`console.info` como placeholder).

### Verificación de ausencia de cambios en `apps/api`

```bash
git diff --name-only HEAD..origin/master apps/api/
# (sin salida — ningún fichero de apps/api modificado)
```

No hay llamadas curl que ejecutar. La verificación de endpoints queda **exenta por alcance**.

---

## Outcome

**N/A — Exento por alcance (frontend-only, sin endpoints nuevos ni modificados).**
