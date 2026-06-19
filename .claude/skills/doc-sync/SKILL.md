---
name: doc-sync
description: Usar cuando tras un cambio de código haya que sincronizar la documentación en español manteniendo la consistencia cruzada entre docs.
---
# Sincronización de documentación

## Cuándo usar
- Tras cualquier cambio de código que afecte modelo de datos, endpoints o enums.
- Cuando actúa el `docs-keeper`: mantiene los docs en español coherentes entre sí.

## Reglas / Pasos
1. Revisar los cambios de código e **identificar los docs afectados**.
2. Mantener la **consistencia cruzada**:
   - `data-model.md` ↔ `er-diagram.md` ↔ `schema.prisma` → las entidades coinciden.
   - `api-spec.yml` ↔ casos de uso ↔ `*-standards.md` → los endpoints coinciden.
   - **Enums** coherentes en todos los docs (mismos valores y nombres).
3. Actualizar **cada** doc afectado (no solo uno).
4. Verificar los **cross-links** entre documentos.
5. **Reportar** qué se actualizó.
6. Todo en **español**.

## Patrón de referencia
Proceso:
```
cambio de código
  → identificar docs afectados
  → actualizar cada uno (data-model, er-diagram, schema.prisma, api-spec, casos de uso, standards)
  → verificar cross-links
  → reportar cambios
```
Ejemplo de report:
```md
## Docs sincronizados
- data-model.md: añadida entidad FechaBloqueada (UNIQUE tenant_id+fecha).
- er-diagram.md: relación Reserva→FechaBloqueada.
- schema.prisma: verificado que coincide.
- api-spec.yml: endpoint POST /reservas con estado 409 documentado.
```

## Errores comunes
- Actualizar el código y olvidar el doc (o actualizar solo uno de los pares).
- Enums divergentes entre `schema.prisma`, `er-diagram.md` y `api-spec.yml`.
- Endpoints en `api-spec.yml` que no aparecen en casos de uso o standards.
- Dejar cross-links rotos.
- Escribir docs en inglés.

## Fuentes
- `docs/documentation-standards.md`
