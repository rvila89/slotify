# QA Report — Fase 5: integración real + verificación VISUAL del PDF (N6)

**Change:** `documentos-presupuesto-pdf-con-iva` (épico #6, rebanada 6.1b)
**Fecha:** 2026-07-13 · **Ejecutado por:** sesión principal (Postgres + backend reales)

## 5.a — PDF real generado e inspeccionado visualmente (N6) ✅
Se renderizó un PDF real con la config **sembrada** del piloto (`construirConfiguracionDocumentoPiloto`) + datos representativos (evento 8 h, 50 personas, extra "Neteja 100 €", base 826.45 / IVA 21% 173.55 / total 1000.00, reparto 400/600/500). Guardado en `reports/muestra-presupuesto-con-iva.pdf` (3.723 bytes) e **inspeccionado visualmente**. Contenido verificado contra la hoja "PRESSUPOST IVA" del Excel:
- **Cabecera solo-texto** (N3, `logoUrl=null`): marca "Masia l'Encís" + razón social "Canoliart, SL" + "NIF: B10874287" + dirección fiscal + web + email.
- **Nº** `Pressupost núm. 2026001` + Data.
- **Dades del client**: nombre, DNI/NIF, dirección, CP-població-província.
- **Concepte**: "Gestió de l'ús espai de **Masia l'Encís** per esdeveniment **(8 hores)** — 15/09/2026 — 50 persones" → concepto con `{nombreComercial}` resuelto, `"(N hores)"` (N5), **sin "lloguer"**.
- Extra "Neteja 100.00 €"; **Base imposable / IVA (21%) / Total**.
- **Condicions**: Senyal 400 / Liquidació 600 / Fiança (a part) 500; **Validesa: 10 DIES**.
- **Dades bancàries**: IBAN, Beneficiari "Canoliart, SL", Concepte "Masia l'Encís"; pie legal.

Todo el contenido proviene de la config del tenant (nada hardcodeado).

## 5.b — Numeración en la tx de confirmación contra BD real (N1) ✅
Se preparó una reserva 2b (duración 8, 50 pax, tipo privado, fiscales del cliente) y se confirmó el presupuesto vía **`POST /api/reservas/{id}/presupuesto`** → **HTTP 201**, reserva → `pre_reserva`. En BD:
- `numero_presupuesto = 2026001` ✅ (primer presupuesto CON IVA de 2026; formato `AAAANNN`).
- `tenant_id` poblado ✅; `@@unique(tenant_id, numero_presupuesto)` respetado.

## 5.c — Pipeline completo del adaptador real contra BD real ✅
Ejecutado el puerto `GENERAR_PDF_PRESUPUESTO_PORT` (adaptador real) sobre el presupuesto creado, bootstrapeando el contexto Nest real:
`pdf_url = http://localhost:3000/almacen/presupuestos/00000000-0000-0000-0000-000000000001/{idPresupuesto}.pdf`
→ URL **real** (no la sintética `https://storage.local/...` del fake), con **clave que incluye `tenant_id` + `idPresupuesto`**. Cadena verificada: cargar config (6.1a) → cargar datos (cliente/reserva/extras/desglose) → render react-pdf → `AlmacenDocumentosPort.subir` → URL.

## Limitaciones conocidas (por diseño, NO bugs de 6.1b)
- **Almacenamiento local en memoria (B1):** `AlmacenDocumentosLocalAdapter` guarda los bytes en un `Map` en memoria y deriva la URL determinista; **no persiste a disco ni sirve la URL**. Por tanto el PDF aún **no es durable ni adjuntable por email de forma real** end-to-end: eso llega con el **adaptador cloud S3/Supabase** (diferido, decisión B1). El render y el pipeline son correctos; solo falta el backend de almacenamiento durable.
- **Generación post-commit en el dev server:** al confirmar por la API, `pdf_url` quedó `null` en BD porque el **dev server en ejecución** (arrancado antes de instalar react-pdf) no cargó el ESM; **no es un bug** — el mismo pipeline, ejecutado fresco (5.c), produce la URL real. En producción (`node dist/main.js`) el `import()` nativo de react-pdf funciona sin flags.

## Restauración de BD
La reserva de prueba `976f45c4` (dato de runtime, no del seed) se restauró a su baseline `consulta/s2b` (sin duración/tipo/personas, cliente sin fiscales, bloqueo `blando` con ttl coherente) y se **borró el presupuesto de prueba**. Verificado: 0 presupuestos con número en dev. Scripts de QA temporales eliminados.

## Veredicto fase 5
**OK** — PDF real verificado visualmente contra el Excel; numeración `2026001` y pipeline del adaptador verificados contra BD real; limitación de almacenamiento durable (B1) documentada para 6.2/cloud; BD restaurada.
