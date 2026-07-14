# QA step-N+2 — Verificación de integración + PDF real

**Change**: `documentos-condiciones-particulares-pdf` (épico #6, rebanada 6.4a)
**Fecha**: 2026-07-14
**Ejecutado desde**: sesión principal (Postgres `slotify_dev`).

> 6.4a **no añade endpoint HTTP** (E2 es post-commit interno; el envío E3 y su endpoint son 6.4b).
> Por eso, en lugar de curl a un endpoint inexistente, se verifica la GENERACIÓN real del PDF y el
> comportamiento del disparo E2 con dos adjuntos (plan D5, aprobado en el gate).

## 1. Generación del PDF real de "Condicions particulars"

Renderizado con `renderizarDocumentoCondicionesABytes(config)` desde la config del tenant piloto
(idéntica a la fila `plantilla_documento_tenant` verificada en step-N+1):
- **9121 bytes**, cabecera `%PDF-`, 14 secciones.
- Muestra guardada en `reports/pdf-muestra/condicions-particulars-piloto.pdf`.

### Inspección visual (3 páginas) — ✅
- **Cabecera**: "Masia l'Encís" (comercial) · "Canoliart, SL" (fiscal) · NIF B10874287 · dirección ·
  web · email. Razón social ≠ nombre comercial correctamente diferenciados.
- **Título** "Condicions Particulars" + las **14 secciones** con el texto catalán íntegro y los
  caracteres especiales correctos (à, ò, ç, ·, ï, €, ').
- **Bloque de firma EN BLANCO** al final: NOM I COGNOMS CLIENT / SIGNATURA CLIENT / DNI /
  DATA ESDEVENIMENT, con líneas vacías para que el cliente lo rellene y firme (fiel al Excel;
  sin datos de reserva).

## 2. Degradación a `null` (D3)

Cubierto por `pdf-condiciones.real.adapter.spec.ts` (verde):
- Config del tenant `null` → adapter devuelve `null` sin renderizar ni subir.
- Config presente pero `condiciones.secciones` vacío → también `null` (no adjunta PDF hueco).
- Con secciones → render → `subir(bytes, 'condiciones/{tenantId}.pdf')` → URL; clave aislada por tenant.

## 3. Disparo E2 con dos adjuntos

Cubierto por `disparar-e2.adapter.spec.ts` (verde), al no existir endpoint HTTP:
- Presupuesto + condiciones presentes → el motor de email recibe **dos** `AdjuntoRef`:
  `{clave:'presupuesto'}` y `{clave:'condiciones', nombre:'condicions-particulars.pdf'}`.
- Condiciones `null` → solo el adjunto `presupuesto`, sin romper el E2 (fire-and-forget).
- Presupuesto `null` y condiciones `null` → `adjuntos: []`, sin fallar.
- Idempotencia E2 `(reserva, E2)` y comando de despacho intactos.

## 4. Estado de BD
Sin mutaciones adicionales en este paso (solo lectura de la config + render en memoria). El estado
persistente (migración + 14 secciones) es el de step-N+1, entregable del change.

## 5. E2E Playwright (step-N+3)
**NO APLICA**: 6.4a no tiene frontend nuevo (sin UI). La UI de ajustes del tenant es 6.5.

## Veredicto step-N+2
PDF real generado y validado visualmente (14 secciones + firma en blanco, fiel al Excel).
Degradación a `null` y disparo E2 con dos adjuntos verificados por tests. **APTO para continuar.**
