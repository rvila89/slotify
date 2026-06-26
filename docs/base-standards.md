---
description: Reglas y directrices de desarrollo de Slotify, aplicables a todos los Agentes IA (Claude, Cursor, Codex, Gemini, etc.).
alwaysApply: true
---

# Estándares base — Slotify

> Plataforma SaaS de gestión integral para espacios boutique de eventos privados.
> Documentos de contexto canónicos: [architecture.md](./architecture.md) · [er-diagram.md](./er-diagram.md) · [use-cases.md](./use-cases.md) · [c4-diagrams.md](./c4-diagrams.md).

## 1. Principios fundamentales

- **Pasos pequeños, de uno en uno**: trabaja siempre en *baby steps*. Nunca avances más de un paso.
- **Desarrollo guiado por tests (TDD)**: empieza por tests que fallan para cualquier funcionalidad nueva, según el detalle de la tarea. **El núcleo crítico se testea primero**: bloqueo atómico de fecha bajo transacciones concurrentes, promoción de cola y encadenamiento, antes que UI o CRUD (ver [architecture.md §2.7](./architecture.md)).
- **Type-safety extremo a extremo**: TypeScript en front y back + contrato OpenAPI + Prisma. Todo el código debe estar completamente tipado; nada de `any` injustificado.
- **La reserva es el agregado raíz (DDD)**: toda la lógica de estado, bloqueo de fecha y cola orbita alrededor de la entidad `Reserva`.
- **Multi-tenancy desde el día 1**: `tenant_id` en toda entidad de negocio + RLS en PostgreSQL. Ninguna consulta cruza tenants.
- **Cambios incrementales y enfocados** frente a modificaciones grandes y complejas.
- **Cuestiona supuestos** e inferencias; explicítalos antes de codificar.
- **Detecta patrones repetidos** y señálalos para refactor (DRY).

## 2. Política de idioma

Slotify usa un **lenguaje ubicuo en español** para el dominio y documentación en español. La regla precisa es:

| Artefacto | Idioma |
|---|---|
| **Documentación técnica** (`docs/`, READMEs, specs, comentarios de PR) | **Español** |
| **Comentarios de código** | **Español** |
| **Identificadores del dominio** (entidades, casos de uso, columnas DB, eventos de dominio, propiedades de negocio) | **Español**, coherente con el ERD: `Reserva`, `fecha_evento`, `FechaBloqueada`, `bloquearFecha()`, `posicion_cola` |
| **Andamiaje técnico/framework** (decoradores, hooks, tipos genéricos, palabras clave, librerías, configuración) | Convención estándar de cada tecnología (inglés): `@Injectable()`, `useState`, `Promise<T>` |
| **Mensajes de error de la API y de log** | Español (orientados al gestor/usuario) |
| **Nombres de ramas git** | Inglés técnico con prefijo `feature/...` (ver §convención de OpenSpec y los `*-standards`) |
| **Mensajes de commit** | Español o inglés técnico conciso; descriptivos del cambio |

**Regla práctica:** si un concepto pertenece al negocio de Slotify, va en español (como en `er-diagram.md` y `use-cases.md`). Si es una pieza del framework o del ecosistema, se respeta su nombre nativo. No se traducen las APIs de las librerías.

## 3. Estándares específicos

Para directrices detalladas por área, consulta:

- [Backend Standards](./backend-standards.md) — NestJS, arquitectura hexagonal + DDD, Prisma, PostgreSQL/RLS, bloqueo atómico, OpenAPI, testing y seguridad del backend.
- [Frontend Standards](./frontend-standards.md) — SPA Vite + React, Tailwind + shadcn/ui, cliente OpenAPI, estado de servidor, testing y arquitectura del frontend.
- [Documentation Standards](./documentation-standards.md) — estructura, formato y mantenimiento de la documentación técnica y de las AI specs.
- [Development Guide](./development_guide.md) — puesta en marcha del entorno (monorepo `apps/web` + `apps/api`, PostgreSQL, Prisma) y ejecución de tests.
- [OpenSpec Tasks Mandatory Steps](./openspec-tasks-mandatory-steps.md) — checklist obligatorio y reglas de ejecución al crear o actualizar `tasks.md` de OpenSpec.

## 4. Skills del proyecto

- Las skills viven en `.claude/skills`.
- Cuando una petición encaje con una skill, carga y sigue el `SKILL.md` correspondiente automáticamente antes de continuar.
- Carga también los ficheros referenciados por la skill (por ejemplo `references/*.md`) cuando la skill lo requiera.

## 5. Requisito de modelo para planificación

Los flujos de planificación deben ejecutarse con **Opus con razonamiento alto**.

Aplica a:
- `enrich-us`
- `openspec-ff-change`
- `openspec-continue-change`

Antes de iniciar cualquiera de estos flujos, verifica que la sesión usa Opus razonamiento alto. Si no es así, **autocorrige** añadiendo `"model": "claude-opus-4-8"` a `.claude/settings.json` y continúa — no te detengas a preguntar al usuario. Haz lo mismo para volver a Sonnet medio en cualquier otro paso.

## 6. Actualización obligatoria de artefactos OpenSpec para cambios post-apply

Cuando aparezca una nueva petición de fix/cambio después de `opsx:apply` (o `/apply`) y antes de `opsx:archive` (o `/archive`), los agentes deben tratarla **primero como una actualización de spec**, no como un "arréglalo rápido" informal. Es el principio central de OpenSpec: la documentación es la fuente de verdad.

Orden requerido:

1. Actualiza los artefactos del cambio OpenSpec actual afectados (escenarios, requisitos/specs y `tasks.md`). No añadas tareas como "bugfixes" sino como parte del diseño inicial, en la sección que corresponda.
2. Si hace falta regenerar artefactos, ejecuta el paso OpenSpec correspondiente (`opsx:continue`, `opsx:ff` o equivalente) antes de codificar.
3. Implementa código solo después de que los artefactos reflejen la nueva petición.
4. Re-ejecuta la verificación contra los artefactos actualizados antes de archivar.

No apliques fixes directos solo-código en esta ventana sin actualizar los artefactos OpenSpec.
