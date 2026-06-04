---
id: US-001
estado: backlog
branch: null
pr: null
---

# 🧾 Historia de Usuario: Iniciar Sesión

## 🆔 Metadatos
- ID: US-001
- Área funcional: Autenticación
- Módulo: Transversal (Auth) — plataforma transversal descrita en SlotifyGeneralSpecs §3.1; Auth no pertenece a M1–M12 de negocio sino a la capa transversal de infraestructura.
- Prioridad: Alta  (heredada de UC-01)
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

---

## 🎯 Historia
**Como** Gestor  
**Quiero** autenticarme con mi email y contraseña para acceder al sistema  
**Para** gestionar las reservas del tenant de forma segura, garantizando que solo personal autorizado puede operar sobre la fuente única de verdad

---

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-01
- Entidades implicadas: `USUARIO`, `TENANT`, `AUDIT_LOG`
- Dolor(es) que resuelve: **D1** — El acceso autenticado garantiza que la fuente única de verdad (el sistema) no pueda ser alterada por actores no autorizados. Sin login, cualquier agente externo podría modificar el estado de las reservas, violando la integridad del single source of truth.
- Automatización relacionada: ninguna (login es acción manual del gestor)
- Email relacionado: ninguno (E1–E8 se disparan desde reservas, no desde auth)
- Reglas de negocio:
  - El `tenant_id` y el `rol` del usuario viajan en el payload del access token JWT firmado; el backend los lee en cada petición para el aislamiento multi-tenant (architecture.md §2.8).
  - El **access token** (JWT) tiene vida corta (~15 min) y se almacena en memoria de la SPA — **nunca** en `localStorage` ni `sessionStorage` (architecture.md §2.8).
  - El **refresh token** (vida ~7 días) se almacena en cookie `httpOnly + Secure + SameSite`, inaccesible desde JavaScript para protección ante XSS (architecture.md §2.8).
  - Las contraseñas se almacenan con hash (bcrypt o argon2); el sistema nunca guarda ni transmite contraseñas en claro (architecture.md §2.8).
  - Un acceso exitoso **siempre** genera un registro en `AUDIT_LOG` (UC-01, paso 7; er-diagram §3.17).
  - En el MVP todos los usuarios tienen `rol = gestor`; la gestión de usuarios por un admin-tenant queda fuera del alcance (architecture.md §2.8).
- Supuestos:
  - El gestor existe y ha sido provisionado mediante seed/script al crear el tenant (no existe UI de registro en MVP).
  - El tenant está activo en el momento del login.
  - El sistema opera con un único tenant activo (Masia l'Encís) durante el MVP.
- Dependencias: US-000A (app shell y esqueleto de navegación — el login se monta sobre el routing que establece y redirige al shell tras autenticar; su layout de auth es propio y no usa este shell).
- Notas de alcance:
  - **FA-03 (sesión en otro dispositivo):** se genera el criterio de aceptación per la especificación UC-01, aunque la implementación exacta del multi-device (registro de sesiones activas) queda sujeta a decisión de sprint.
  - La gestión de roles múltiples (admin-tenant, operario) y la creación de usuarios por UI son `📐 Solo diseñado` — fuera del MVP.
  - Registro de intentos fallidos / bloqueo de cuenta: UC-01 FA-02 lo documenta; la política de bloqueo (nº de intentos, duración) es configurable y no está fijada por la spec.

---

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path

- **Dado** que el gestor tiene una cuenta activa en el tenant  
  **Cuando** introduce su email y contraseña correctos y confirma el formulario de login  
  **Entonces** el sistema valida las credenciales contra la contraseña hasheada de `USUARIO`, genera un access token JWT (con `tenant_id` y `rol` en payload), establece el refresh token en cookie `httpOnly`, redirige al calendario y registra el evento `login` en `AUDIT_LOG`

- **Dado** que el gestor ha iniciado sesión con éxito  
  **Cuando** el frontend realiza cualquier petición autenticada a la API  
  **Entonces** el backend extrae `tenant_id` y `rol` del access token firmado, aplica el aislamiento multi-tenant y procesa la petición sin necesidad de consultar la base de datos para validar el tenant en cada llamada

---

### ⚠️ Flujos Alternativos y Edge Cases

#### FA-01 — Credenciales inválidas (email no existe o contraseña incorrecta)
- **Dado** que el gestor introduce un email inexistente o una contraseña que no coincide con el hash almacenado  
  **Cuando** confirma el formulario de login  
  **Entonces** el sistema devuelve un mensaje de error genérico ("Credenciales incorrectas") sin especificar cuál campo es incorrecto (para no revelar qué emails existen en el sistema), y el gestor puede reintentar
- Comportamiento del sistema: el error no diferencia "email no existe" de "contraseña incorrecta" — respuesta uniforme para prevenir user enumeration (OWASP A01).

#### FA-02 — Cuenta bloqueada
- **Dado** que la cuenta del gestor tiene el estado `activo = false` en `USUARIO`  
  **Cuando** introduce credenciales  
  **Entonces** el sistema muestra un mensaje informando de que la cuenta está deshabilitada y sugiere contactar con el administrador; no se genera un token ni se registra login en `AUDIT_LOG`
- Comportamiento del sistema: el bloqueo de cuenta se gestiona mediante el campo `activo` de `USUARIO`; en MVP la reactivación se hace por script/seed, no por UI.

#### FA-03 — Sesión activa en otro dispositivo
- **Dado** que el gestor ya tiene una sesión activa (refresh token válido desde otro dispositivo)  
  **Cuando** inicia sesión desde un nuevo dispositivo  
  **Entonces** el sistema le informa de la sesión existente y le ofrece dos opciones: continuar (ambas sesiones coexisten) o cerrar la sesión anterior (invalida el refresh token anterior)
- Comportamiento del sistema: la implementación de multi-device queda acotada al ciclo de vida del refresh token; si el token anterior se invalida, el dispositivo origen recibirá un 401 en el próximo intento de renovación.

#### Edge case — Campos vacíos o formato de email inválido
- **Dado** que el gestor deja el campo email o contraseña vacío, o introduce un email con formato inválido  
  **Cuando** intenta confirmar el formulario  
  **Entonces** el sistema bloquea el envío en el frontend y muestra mensajes de validación por campo antes de realizar cualquier llamada a la API

#### Edge case — Refresh token expirado o inválido
- **Dado** que el access token del gestor ha expirado y el refresh token también ha expirado (o ha sido invalidado)  
  **Cuando** el frontend intenta obtener un nuevo access token mediante `/auth/refresh`  
  **Entonces** el sistema devuelve 401, limpia la cookie del refresh token y redirige al gestor al formulario de login

---

### 🚫 Reglas de Validación
- El campo `email` de `USUARIO` tiene restricción `UNIQUE` en la base de datos (er-diagram §3.3). El login opera como lookup por email dentro del `tenant_id`.
- La contraseña se verifica siempre mediante comparación hash; el sistema nunca almacena ni registra el valor en claro.
- El access token no puede guardarse en `localStorage` — violación de política de seguridad documentada en architecture.md §2.8.
- Solo usuarios con `activo = true` pueden autenticarse.
- El registro en `AUDIT_LOG` es obligatorio en todo login exitoso (postcondición de UC-01).

---

## 📊 Impacto de Negocio
- Impacto esperado: El gestor accede al sistema de forma segura y trazada, eliminando el riesgo de acceso no autorizado a los datos operativos y financieros del tenant (reservas, facturas, datos de cliente).
- Criterio de éxito: 100 % de los accesos quedan registrados en `AUDIT_LOG`. 0 tokens almacenados en `localStorage` (verificable mediante auditoría de código). Tiempo de login (happy path) < 1 s en condiciones normales.
