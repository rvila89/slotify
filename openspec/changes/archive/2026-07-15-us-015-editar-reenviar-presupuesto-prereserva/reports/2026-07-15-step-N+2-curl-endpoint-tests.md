# QA — Pruebas manuales con curl + verificación de BD real (US-015)

> Ejecutado desde la sesión principal (con Postgres real), porque los subagentes QA no
> tienen acceso a la BD (memoria del proyecto). Fecha: 2026-07-15.

## Entorno

- API NestJS levantada en `http://localhost:3000` con prefijo global `/api`.
- BD: `slotify_dev` (contenedor `slotify-postgres`, healthy).
- Auth: `gestor-a1@slotify.test` / `Slotify2026!`, tenant `00000000-0000-0000-0000-000000000001`, rol `gestor` (JWT).
- Reserva de prueba en `pre_reserva`: `d1f92f88-00a5-4f9d-8989-dd8fc661878a`
  - Baseline: PRESUPUESTO v1 `enviado`, total 1076.00 (base 889.26 + IVA 186.74), `numero_presupuesto` null, régimen `con_iva`, `metodo_pago=transferencia`.
  - `FECHA_BLOQUEADA.ttl_expiracion` baseline: `2026-07-20 15:01:30.626`.
- Extras catálogo tenant 1: Barbacoa (30€), Paellero (30€).

## Escenarios verificados

| # | Escenario (AC) | Resultado | Evidencia |
|---|----------------|:---:|-----------|
| A | Preview edición con descuento 200 (no persiste) | ✅ | total 876.00 (base 723.97 + IVA 152.03); `tarifaAConsultar=false`; recuento de versiones sin cambios (1) |
| B | Edición `enviar=true` con descuento 200 | ✅ | crea v2 `enviado` total 876.00, `descuento_eur=200.00`, `numero_presupuesto=2026001`, `tarifa_congelada=true`; v1 conservada; RESERVA sigue `pre_reserva`; ttl sin cambios; 1 COMUNICACION E2 `es_reenvio=true`; 1 AUDIT_LOG `actualizar`/PRESUPUESTO |
| C | Añadir extra (1ª persistencia real de RESERVA_EXTRA — D3) | ✅ | v3 total 906.00, `numero=2026002`; RESERVA_EXTRA: `precio_unitario=30.00`, `subtotal=30.00`, `origen=anadido_post_confirmacion`, `factura_id=null` |
| D | Guardar borrador (`enviar=false`) | ✅ | v5 `borrador`, `numero_presupuesto=null`, sin COMUNICACION, sin email |
| E | Reenvío sin cambios | ✅ | NO crea versión (max_ver estable), reusa `numero` de la vigente, nueva COMUNICACION E2 `es_reenvio=true` |
| F | Estado inválido — RESERVA fuera de pre_reserva | ✅ | 409 `RESERVA_FUERA_DE_PRERESERVA` al editar una reserva en `consulta` |
| G | Validación: descuento > base_imponible | ✅ | 422 `DESCUENTO_INVALIDO` |
| H | Validación: duración ∉ {4,8,12} | ✅ | 422 `DURACION_INVALIDA` |
| I | >50 invitados → tarifa a consultar | ✅ | preview devuelve `tarifaAConsultar=true` (200) |
| J | >50 invitados + `enviar` sin precio manual | ✅ | 422 `PRECIO_MANUAL_REQUERIDO` |
| K | **Congelado de precio en re-edición (AC-2)** | ✅ (tras fix) | ver sección "Bug encontrado y corregido" |

## Invariantes (memoria US-049 — verificar contra BD real)

- `RESERVA.estado` permanece `pre_reserva` tras editar/enviar/reenviar. ✅
- `FECHA_BLOQUEADA.ttl_expiracion` NO cambia (baseline preservado). ✅
- Numeración por envío: cada envío de versión consume un `AAAANNN` nuevo (2026001, 2026002, 2026003…); borrador queda `null`. ✅
- COMUNICACION: exactamente **una** fila E2 `es_reenvio=true` por envío (sin doble registro motor↔COMUNICACION — resolvía la preocupación #3 del backend). ✅
- AUDIT_LOG: exactamente un `actualizar`/PRESUPUESTO por edición confirmada. ✅

## Bug encontrado y corregido durante la QA (AC-2 — congelado de precio)

**Síntoma:** con barbacoa persistida a 30€ (congelada), al subir el catálogo a 50€ y
re-editar manteniendo barbacoa con el payload REAL del contrato (`{extraId, cantidad}`),
la línea existente volvía a **50.00** en vez de conservar su **30.00** congelado.

**Causa raíz:** `resolverLineasExtras` casaba las líneas existentes SOLO por
`id_reserva_extra`, campo que el contrato OpenAPI (`EdicionExtraInput`), el SDK y el
frontend NO envían (el frontend keyea por `extraId`). Toda línea llegaba como NUEVA y se
recongelaba al precio actual del catálogo → AC-2 roto de punta a punta. Los tests unit no
lo detectaron porque inyectaban `id_reserva_extra` directamente, saltándose el contrato.

**Fix (backend):** matching de línea existente por `extra_id` (identidad de congelado que
usan contrato y frontend), con cola FIFO para el caso "existente + nueva del mismo extra".
Se añadió test de regresión con el payload real (sin `id_reserva_extra`). 49/49 verdes.

**Re-verificación end-to-end contra Postgres (post-fix):**
1. Añadir barbacoa(1) con catálogo=30 → línea congelada a **30.00** (v6).
2. Subir catálogo barbacoa 30→50.
3. Re-editar barbacoa(1)+paellero(1) con `{extraId, cantidad}` → barbacoa **conserva 30.00**; paellero (nueva) toma precio actual del catálogo. ✅ AC-2 satisfecho.

(Catálogo restaurado a 30 tras la prueba.)

## Hallazgo menor (no bloqueante)

- Descuento negativo devuelve **400** (guarda de formato del tipo compartido `Importe`,
  regex `\d+\.\d{2}`) en vez de **422 DESCUENTO_INVALIDO**. Se rechaza igualmente; y el
  frontend lo bloquea antes con la guarda Zod (`descuento >= 0`), así que solo es
  alcanzable por uso directo de la API. Recomendado anotarlo en code-review.

## Veredicto (parte curl + BD)

**APTO.** Todos los criterios de aceptación verificados contra BD real, incluidas las
invariantes de estado/ttl y la numeración. El único defecto (congelado de precio AC-2) se
detectó, corrigió y re-verificó end-to-end. Queda 1 hallazgo menor documentado.
