---
id: US-002
estado: backlog
branch: null
pr: null
---

# 🧾 Historia de Usuario: Cerrar Sesión

## 🆔 Metadatos
- ID: US-002
- Área funcional: Autenticación
- Módulo: Transversal (Auth) — plataforma transversal descrita en SlotifyGeneralSpecs §3.1; Auth no pertenece a M1–M12 de negocio sino a la capa transversal de infraestructura.
- Prioridad: Alta  (heredada de UC-02)
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

---

## 🎯 Historia
**Como** Gestor  
**Quiero** cerrar mi sesión activa de forma explícita  
**Para** garantizar que ningún acceso no autorizado quede abierto tras terminar mi jornada de trabajo, protegiendo los datos operativos y financieros del tenant

---

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-02
- Entidades implicadas: `USUARIO`, `AUDIT_LOG`
- Dolor(es) que resuelve: **D1** — El cierre de sesión explícito es la garantía de que la fuente única de verdad queda protegida tras cada sesión de trabajo; evita accesos no autorizados si el dispositivo queda desbloqueado o es compartido.
- Automatización relacionada: ninguna
- Email relacionado: ninguno
- Reglas de negocio:
  - Al cerrar sesión, el sistema invalida el refresh token (borrando la cookie `httpOnly`) y el access token queda obsoleto al expirar su TTL natural (~15 min) o al ser eliminado de la memoria de la SPA (architecture.md §2.8).
  - El cierre de sesión **siempre** genera un registro en `AUDIT_LOG` con `accion = logout` (UC-02 paso 4; er-diagram §3.17).
  - Tras el cierre, el gestor es redirigido al formulario de login.
  - En MVP, el cierre de sesión opera sobre la sesión activa del dispositivo actual; la invalidación de todas las sesiones en otros dispositivos (global logout) queda fuera del alcance MVP.
- Supuestos:
  - El gestor tiene una sesión activa (access token en memoria SPA + refresh token en cookie).
  - El endpoint `/auth/logout` en el backend elimina / invalida el refresh token en el servidor (o lo añade a una lista de invalidados) antes de limpiar la cookie.
- Dependencias:
  - **US-001 (Iniciar Sesión):** el cierre de sesión presupone que existe una sesión activa iniciada según US-001. Dependencia lógica declarada — acoplamiento de máquina de estados de sesión, no de implementación.
- Notas de alcance:
  - La invalidación de todas las sesiones activas simultáneas en otros dispositivos (global logout) es `📐 Solo diseñado` para post-MVP.
  - No existe UI de "gestión de sesiones activas" en MVP.

---

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path

- **Dado** que el gestor tiene una sesión activa en el sistema  
  **Cuando** selecciona la opción "Cerrar sesión" en la interfaz  
  **Entonces** el sistema invalida el refresh token (limpia la cookie `httpOnly`), elimina el access token de la memoria de la SPA, redirige al gestor al formulario de login y registra el evento `logout` en `AUDIT_LOG` con el `usuario_id` y `tenant_id` correspondientes

- **Dado** que el gestor ha cerrado sesión  
  **Cuando** intenta acceder a cualquier ruta protegida (p. ej. el calendario) directamente por URL  
  **Entonces** el sistema redirige al formulario de login sin exponer datos protegidos

---

### ⚠️ Flujos Alternativos y Edge Cases

#### Edge case — Access token ya expirado en el momento del logout
- **Dado** que el access token del gestor ha expirado naturalmente (TTL ~15 min) pero el refresh token sigue siendo válido  
  **Cuando** el gestor selecciona "Cerrar sesión"  
  **Entonces** el sistema igualmente invalida el refresh token, limpia la cookie y redirige al login; el logout completa con éxito independientemente del estado del access token

#### Edge case — Error de red durante el logout
- **Dado** que el gestor selecciona "Cerrar sesión" pero la llamada al endpoint `/auth/logout` falla por error de red  
  **Cuando** el frontend no recibe confirmación del servidor  
  **Entonces** el frontend limpia igualmente el access token de memoria y muestra un mensaje de aviso; el gestor queda sin acceso efectivo en el cliente aunque el refresh token pudiera no haberse invalidado en servidor (caso degradado)
- Comportamiento del sistema: el refresh token en cookie `httpOnly` expirará por TTL natural (~7 días) si no fue invalidado; el riesgo es acotado y documentado como comportamiento degradado aceptable en MVP.

#### Edge case — Sesión ya inválida (logout doble)
- **Dado** que el gestor ha cerrado sesión en un dispositivo y el refresh token fue invalidado  
  **Cuando** desde el mismo u otro dispositivo se intenta cerrar sesión de nuevo (refresh token expirado/invalidado)  
  **Entonces** el sistema responde con 200 o 204 de forma idempotente (no devuelve error), redirige al login; el `AUDIT_LOG` registra el intento solo si hay usuario identificable en el token

---

### 🚫 Reglas de Validación
- El endpoint de logout debe requerir un token válido (o al menos el refresh token en cookie) para identificar al usuario; no puede ser llamado de forma anónima para invalidar sesiones ajenas.
- El registro en `AUDIT_LOG` es obligatorio en todo logout procesado por el servidor (postcondición de UC-02).
- Después del logout, ninguna petición con el access token previo debe ser aceptada por el backend (el TTL del access token hace que expire naturalmente en ≤ 15 min; no es necesario revocar el access token de forma activa en MVP).

---

## 📊 Impacto de Negocio
- Impacto esperado: El gestor puede cerrar sesión con confianza, sabiendo que su acceso queda completamente revocado. Reduce el riesgo de acceso no autorizado en dispositivos compartidos o no vigilados.
- Criterio de éxito: 100 % de los logouts exitosos quedan registrados en `AUDIT_LOG`. 0 tokens activos reutilizables tras logout (refresh token invalidado en servidor). Tiempo de logout (happy path) < 500 ms.
