---
name: review-checklist
description: Usar cuando el code-reviewer revise un diff y deba producir un informe de solo lectura contra el checklist de Slotify.
---
# Checklist de revisión de código

## Cuándo usar
- Cuando actúa el `code-reviewer` sobre un diff.
- Su salida es un **informe** (solo lectura): **NO** aplica auto-fix.

## Reglas / Pasos
Revisar el diff contra este checklist y reportar cada hallazgo:
1. **Hexagonal**: `domain/` sin imports de `infrastructure/` ni de frameworks.
2. **Multi-tenancy**: las queries filtran por `tenant_id`; el tenant viene del **JWT**, nunca del path/body.
3. **Bloqueo de fecha**: solo vía `bloquearFecha()` / `liberarFecha()`. Sin Redis ni ninguna otra forma.
4. **Máquina de estados**: modelada como **tabla declarativa**, no como `if/else` disperso.
5. **Importes** en `Decimal`, nunca `Float`.
6. **DTOs** validados con `class-validator`.
7. **Errores en español**.
8. **Tests primero** (TDD): existe el test correspondiente antes del código.
9. **Contrato OpenAPI** coincide con los DTOs.
10. **Cliente HTTP del frontend** generado, no editado a mano.
11. **Convenciones de nombres**: PascalCase / camelCase / kebab-case, en español.
12. **Responsive (frontend)**: UI mobile-first que se adapta a móvil/tablet/escritorio sin layout roto ni overflow; nav lateral colapsa a drawer en `<lg`; sin anchos px fijos que rompan en móvil; evidencia en 3 viewports (390/768/1280).
13. **Estructura por dominio (frontend)**: feature en `features/<dominio>/` con segmentos (`api/components/lib/model/pages/`) y barrel `index.ts`; páginas complejas co-localizan schema/constantes/sub-componentes (sin componentes monolíticos que mezclen todo); se importa una feature solo por su barrel (no archivos internos); lo compartido (`components/`,`hooks/`,`lib/`) no importa de `features/`; archivos ≤300 líneas. (`pnpm lint` lo verifica vía boundaries/no-restricted-imports/max-lines.)

## Patrón de referencia
Formato del informe:
```md
## Informe de revisión
### Bloqueantes
- [hexagonal] domain/reserva.ts importa PrismaService (línea 10) → mover a infra.
### Advertencias
- [importes] señal usa number en vez de Decimal (línea 42).
### OK
- multi-tenancy, máquina de estados, errores en español.
```
No proponer parches aplicados; solo describir el problema y la corrección sugerida.

## Errores comunes
- Auto-corregir el código en vez de solo informar.
- Pasar por alto un import de infra en domain o un tenant tomado del body.
- Aceptar `Float` para importes o `if/else` para transiciones de estado.
- No comprobar que el contrato OpenAPI y los DTOs coinciden.

## Fuentes
- `CLAUDE.md`, `docs/backend-standards.md`
- skill `architecture-guardrails`
