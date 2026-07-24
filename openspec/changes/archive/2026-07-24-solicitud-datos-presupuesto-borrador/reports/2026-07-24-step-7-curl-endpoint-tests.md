# Step 7 — QA: pruebas manuales con curl

**Change:** `solicitud-datos-presupuesto-borrador` · **Fecha:** 2026-07-24
**Entorno:** API real (`pnpm dev`) en `:3100` (prefijo global `/api`) contra `slotify_dev`; login
gestor seed `info@masialencis.com`. Reservas de prueba sembradas en `slotify_dev` (limpiadas al final).

> El arranque de la API ya valida el **wiring DI en runtime** (Nest arrancó sin errores de
> resolución y mapeó la ruta `POST /api/reservas/:id/comunicaciones/solicitar-datos-presupuesto`).
> Esta batería verifica el **mapeo HTTP del controller** (status + envelope de error), que la
> integración (§6.3, nivel use-case/adaptador) no cubría.

| # | Caso | Esperado | Resultado |
|---|------|----------|-----------|
| 1 | Reserva `es`, fiscal incompleto | 201 + borrador `E1`/`solicitud_datos`, asunto "Pre-reserva confirmada", cuerpo castellano ("necesitaría los siguientes datos" / "Nombre y apellidos / DNI / Dirección y población"), NO respuesta inicial del catálogo | ✅ PASS |
| 2 | Misma reserva, borrador pendiente | 200 (reutiliza, no duplica) | ✅ PASS |
| 3 | Borrador marcado `enviado` + reintento | 409 `codigo: COMUNICACION_DUPLICADA` | ✅ PASS |
| 4 | Reserva `ca`, fiscal incompleto | 201 + cuerpo catalán ("necessitaria les següents dades" / "Nom i cognoms / DNI / Adreça i població") | ✅ PASS |
| 5 | Reserva con datos fiscales completos | 422 `codigo: DATOS_FISCALES_COMPLETOS` | ✅ PASS |
| 6 | Reserva inexistente | 404 | ✅ PASS |

**Conclusión:** el controller mapea correctamente 201/200/409/422/404 y los `codigo` del envelope
coinciden con el contrato (`COMUNICACION_DUPLICADA`, `DATOS_FISCALES_COMPLETOS`). Datos de prueba
eliminados de `slotify_dev` tras la ejecución.
