---
name: db-state-verify
description: Usar cuando haya que capturar baseline de la BD antes de tests, re-verificar después y restaurar el estado si hubo mutación.
---
# Verificación de estado de BD pre/post

## Cuándo usar
- Antes y después de ejecutar tests o pruebas manuales que toquen la BD.
- En los Steps de QA que crean/actualizan/borran registros.
- Siempre que una verificación deba dejar la BD exactamente como estaba.

## Reglas / Pasos
1. **Baseline (pre)**: capturar `counts` por tabla relevante, registros clave (IDs, estados) y checksums antes de tocar nada.
2. Ejecutar la prueba.
3. **Re-verificar (post)**: volver a capturar los mismos counts/registros/checksums.
4. **Comparar** pre vs post y documentar las diferencias.
5. **Restaurar** si hubo mutación: borrar/revertir los registros creados o modificados para volver al baseline.
6. Filtrar siempre por `tenant_id` al capturar y restaurar.
7. Documentar todo en el report del Step correspondiente (plantilla pre/post).

## Patrón de referencia
```sql
-- PRE baseline (por tenant)
SELECT count(*) FROM reservas WHERE tenant_id = $1;
SELECT id, estado FROM reservas WHERE tenant_id = $1 ORDER BY id;
SELECT count(*) FROM fecha_bloqueada WHERE tenant_id = $1;
```
```md
| tabla            | pre | post | restaurado |
|------------------|-----|------|------------|
| reservas         | 12  | 13   | sí (borrado id=99) |
| fecha_bloqueada  | 4   | 4    | n/a        |
```

## Errores comunes
- Capturar solo counts y no los estados/IDs clave (pierdes mutaciones in-place).
- No restaurar y dejar la BD desviada del baseline.
- Olvidar el filtro por `tenant_id` (mezclas datos de otros tenants).
- No documentar la comparación en el report.

## Fuentes
- `docs/openspec-tasks-mandatory-steps.md`
