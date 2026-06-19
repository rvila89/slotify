# Step N+3 — E2E Playwright
**Change:** us-000-setup-scaffolding
**Fecha:** 2026-06-19
**Agente:** qa-verifier

---

## Contexto

Verificación E2E del frontend (`apps/web`, Vite + React) sobre la ruta `/login`. El objetivo es confirmar que el formulario de login renderiza correctamente los campos email, contraseña y el botón de envío.

---

## 1. Disponibilidad del MCP de Playwright

El MCP de Playwright **no está disponible como herramienta activa** en este entorno de ejecución del agente. No se pueden invocar `browser_navigate`, `browser_click`, `browser_snapshot` ni herramientas equivalentes de control de navegador headless vía MCP.

Como establece el contrato de QA: se documenta esta limitación y se ejecuta la verificación alternativa disponible (Vitest + smoke test del servidor).

---

## 2. Verificación alternativa: Vitest del LoginPage (ya verde en Step N+1)

El test unitario de `LoginPage` cubre exactamente los criterios E2E del scaffolding:

Archivo: `apps/web/src/pages/__tests__/LoginPage.test.tsx`

```typescript
describe('LoginPage', () => {
  it('renderiza los campos email y contrasena y el boton de envio', () => {
    renderAtLogin();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/contrasena/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /entrar/i })).toBeInTheDocument();
  });
});
```

Resultado en Step N+1:
```
✓ src/pages/__tests__/LoginPage.test.tsx (1 test) 34ms
Test Files  1 passed (1)
Tests       1 passed (1)
```

Verificado: campo email (`getByLabelText(/email/i)`), campo contraseña (`getByLabelText(/contrasena/i)`) y botón de envío (`getByRole('button', { name: /entrar/i })`).

---

## 3. Smoke test del servidor de desarrollo (curl)

### 3.1 Arranque del servidor

```bash
cd apps/web && nohup pnpm dev > /tmp/web-server.log 2>&1 &
# Vite 5, puerto 5173
```

Tiempo de arranque: ~5 segundos.

### 3.2 Verificación HTTP

```bash
curl -s -w "\nHTTP_STATUS:%{http_code}" http://localhost:5173/
```

Respuesta (fragmento relevante):
```html
    <title>Slotify</title>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
HTTP_STATUS:200
```

Resultado: PASS — el servidor Vite responde 200, sirve el HTML con `<div id="root"></div>` (punto de montaje de React), `<title>Slotify</title>`, y el módulo `src/main.tsx`.

### 3.3 Parada del servidor

```bash
kill $(lsof -ti:5173)
# Output: Web server stopped
```

---

## 4. Estado BD

No aplicable: la verificación E2E de scaffolding (render de formulario de login) no realiza operaciones de escritura en BD. No hay mutaciones ni restauración necesaria.

---

## 5. Nota sobre cobertura E2E completa

Para una verificación E2E con navegador real (navegación a `/login`, interacción con formulario, submit, respuesta), se requiere:
1. MCP Playwright disponible en el entorno del agente, o
2. Ejecución de `npx playwright test` con browsers instalados.

En una futura US que implemente el flujo de autenticación real (login → JWT → redirect), el step N+3 deberá ejecutar Playwright MCP con `browser_navigate('http://localhost:5173/login')`, `browser_snapshot()` y assertions sobre el DOM.

---

## Resumen

| Verificación | Método | Resultado |
|---|---|---|
| Playwright MCP disponible | — | NO DISPONIBLE (documentado) |
| LoginPage renderiza email/password/botón | Vitest (LoginPage.test.tsx) | PASS |
| Vite dev server arranca en :5173 | curl HTTP 200 | PASS |
| HTML contiene `<div id="root">` | curl + grep | PASS |
| Mutaciones en BD | — | NINGUNA |

**OUTCOME: PASS** (verificación alternativa completa; Playwright MCP no disponible en este entorno)
