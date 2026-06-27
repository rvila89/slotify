---
id: US-000A
estado: en-revision
branch: feature/us-000A-app-shell
pr: 13
---

# 🧾 Historia de Usuario: App Shell y Esqueleto de Navegación

## 🆔 Metadatos
- ID: US-000A
- Área funcional: Infraestructura / Fundación técnica
- Módulo: Transversal (soporta M1–M10)
- Prioridad: Crítica
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Gestor
**Quiero** una estructura de navegación persistente (cabecera, navegación lateral y área de contenido) tras iniciar sesión
**Para** moverme entre las secciones de la aplicación (Calendario, Reservas, Métricas) de forma consistente y poder iniciar una nueva reserva desde cualquier punto

## 🧠 Contexto de Negocio
- Caso(s) de uso: ninguno (historia de infraestructura de UI, prerequisito de toda pantalla autenticada — análoga a US-000)
- Entidades implicadas: ninguna (es armazón de presentación; no lee ni escribe entidades de dominio en su versión mínima)
- Dolor(es) que resuelve: D2 (cero visibilidad/estructura del trabajo diario) de forma transversal — habilita la superficie donde el resto de funcionalidad será visible
- Automatización relacionada: ninguna
- Email relacionado: ninguno
- Reglas de negocio:
  - El app shell solo se renderiza para usuarios autenticados (rutas protegidas). El acceso sin sesión válida redirige al login.
  - La navegación lateral expone las secciones del MVP: Calendario, Reservas, Métricas.
  - La acción "Nueva Reserva" está accesible desde la cabecera en todas las pantallas autenticadas.
  - El layout de autenticación (login) es distinto y NO usa este shell (pertenece a US-001).
- Supuestos:
  - Stack confirmado por `architecture.md §2`: SPA Vite + React + React Router + TypeScript, Tailwind + shadcn/ui.
  - El diseño visual es la fuente de verdad de layout (pantallas Figma: "Calendario - Masia l'Encís" y siguientes comparten este shell).
- Dependencias: US-000 (scaffolding del monorepo — `apps/web` operativo).
- Notas de alcance: esta historia entrega el **armazón** (rutas, layout, navegación, slots vacíos), NO el contenido funcional de cada sección. El calendario que pinta reservas por color de estado, el listado de reservas, etc., son historias aparte que se apoyan en este shell.

## ✅ Criterios de Aceptación (BDD)
### 🎯 Happy Path
- **Dado** un usuario con sesión válida
  **Cuando** accede a la aplicación
  **Entonces** ve el app shell con cabecera (marca + acción "Nueva Reserva" + usuario), navegación lateral con Calendario / Reservas / Métricas, y un área de contenido que renderiza la sección activa

- **Dado** el app shell visible
  **Cuando** el usuario selecciona una sección de la navegación lateral
  **Entonces** el área de contenido cambia a esa ruta sin recargar la página (navegación SPA) y el ítem activo queda resaltado

### ⚠️ Flujos Alternativos y Edge Cases
#### Acceso sin sesión
- **Dado** un usuario sin sesión válida (o token expirado)
  **Cuando** intenta acceder a una ruta protegida del shell
  **Entonces** es redirigido al login (US-001) y, tras autenticar, regresa a la ruta solicitada
- Comportamiento del sistema: las rutas del shell son rutas protegidas; el guard comprueba la sesión en memoria.

#### Ruta inexistente
- **Dado** el usuario autenticado
  **Cuando** navega a una ruta que no existe dentro del shell
  **Entonces** el shell muestra un estado "no encontrado" dentro del área de contenido, conservando la navegación
- Comportamiento del sistema: ruta *catch-all* dentro del layout autenticado.

#### Sección aún no implementada
- **Dado** una sección cuya funcionalidad todavía no está construida
  **Cuando** el usuario la selecciona
  **Entonces** el área de contenido muestra un *placeholder* vacío coherente con el layout, sin romper la navegación
- Comportamiento del sistema: permite desarrollo incremental: cada historia posterior rellena su slot.

### 🚫 Reglas de Validación
- Ninguna ruta del shell es accesible sin sesión válida.
- El shell no asume datos de dominio: debe renderizar correctamente con secciones vacías.
- El layout de login no hereda este shell (separación de layouts auth vs app).

## 📊 Impacto de Negocio
- KPI afectado: ninguno directo (habilitador); reduce el tiempo de desarrollo de toda pantalla posterior al fijar el armazón una sola vez
- Impacto esperado: desbloquea el desarrollo en paralelo de todas las secciones; consistencia de navegación desde el día 1
- Criterio de éxito: el 100% de las pantallas autenticadas posteriores se montan dentro de este shell sin redefinir navegación