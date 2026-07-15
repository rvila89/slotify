# Step N+3 — E2E con Playwright MCP (US-024)

- Fecha: 15/07/2026
- Change: `firma-condiciones-particulares-us024`
- Ejecutado por: **sesión principal** (frontend `vite` :5173 + backend :3000 + `slotify_dev`).
- Capturas: `reports/e2e-screenshots/`.

---

## 7.1 Entorno

- Frontend Vite en `http://localhost:5173`, backend NestJS en `:3000`, BD `slotify_dev`.
- Login por UI con `gestor-a1@slotify.test` (tenant `00000000-...-0001`).
- Datos sembrados en dev (y **limpiados al final**): 2 reservas `reserva_confirmada` —
  una con E3 enviado (`cond_part_enviadas_fecha` informado, `cond_part_firmadas=false`) y otra
  sin E3 (`cond_part_enviadas_fecha=null`).
- Nota (gotcha conocido): la navegación por URL directa (`goto`) recarga la SPA y pierde el
  access token en memoria → rebota a `/login`; tras re-login, RequireAuth restaura el deep-link.
  Sin impacto funcional.

## 7.2 Registrar firma (subida + persistencia + feedback) — OK

- En la ficha de la reserva con E3, sección "Firma de condiciones particulares": botón
  "Registrar condiciones firmadas" → modal con dropzone (accept `.jpg/.jpeg/.png/.pdf`, máx 10 MB).
- "Registrar firma" permanece **deshabilitado** hasta adjuntar fichero; tras seleccionar
  `condiciones-firmadas-e2e.pdf` (application/pdf) se habilita.
- Al confirmar, la sección pasa a estado firmado: *"Condiciones particulares **firmadas** el
  15 de julio de 2026 a las 17:25. La copia firmada queda registrada en la reserva."*
- **Verificación en BD (real)** tras el registro:
  - `RESERVA`: `estado=reserva_confirmada` (INTACTO, sin transición), `condPartFirmadas=true`,
    `condPartFirmadasFecha=2026-07-15T15:25:28Z`.
  - `DOCUMENTO condiciones_particulares`: 1 fila creada, `mimeType=application/pdf`, con **clave
    versionada** `condiciones-firmadas/{tenantId}/{reservaId}/{uuid}.pdf` (decisión Gate 1).
  - `AUDIT_LOG accion='actualizar'`, `datos_anteriores.condPartFirmadas=false`,
    `datos_nuevos.condPartFirmadas=true`; `accion='transicion'` = **0**.
- Capturas: `us024-01-desktop-pendiente.png`, `us024-02-modal-fichero-adjunto.png`,
  `us024-03-desktop-firmada.png`.

## 7.3 Condiciones no enviadas (acción no disponible) — OK

- En la reserva sin E3, la sección muestra: *"Las condiciones particulares no han sido enviadas al
  cliente aún. Completa primero el envío de las condiciones al cliente (E3)."* y **no** renderiza el
  botón de registro. Captura: `us024-04-no-enviadas.png`.

## 7.4 Alerta de firma pendiente — OK

- Antes de firmar, la sección muestra la alerta *"Condiciones particulares pendientes de firma.
  Registra la copia firmada por el cliente cuando la recibas."* (señal N3, informativa, no
  bloqueante). Visible en `us024-01-desktop-pendiente.png`.

## 7.5 Re-firma (afordancia) — OK

- Tras firmar, la sección ofrece "Subir nueva versión firmada" con el texto: *"…puedes volver a
  subirla. Se conservará el histórico y la más reciente será la de referencia."* La re-firma no
  idempotente (nueva versión + histórico) está además cubierta por la integración real
  (`registrar-firma-condiciones-integracion.spec.ts`). La validación de formato/tamaño se aplica en
  cliente (`accept` del input) y de forma autoritativa en servidor (unit del use-case: 422
  `FORMATO_NO_PERMITIDO` / `TAMANO_EXCEDIDO`).

## 7.6 Responsive 390 / 768 / 1280 — OK

Medido `scrollWidth - clientWidth` sobre la ficha con la sección de firma:

| Viewport | Overflow horizontal |
|----------|--------------------|
| 390 (móvil) | **0** |
| 768 (tablet) | **0** |
| 1280 (desktop) | **0** |

Sin overflow horizontal en ninguno; la sección y el modal se adaptan (mobile-first). La deuda
pre-existente de ~15px del app-shell a 768 no se reproduce en esta ficha. Capturas:
`us024-05-mobile-390.png`, `us024-06-tablet-768.png`, `us024-07-desktop-1280.png`.

## 7.7 Consola y restauración

- Errores de consola en la ficha: 404 `/factura-senal` y 409 `/ficha-operativa` — **ajenos a
  US-024** (secciones de US-021/US-022 sobre una reserva sembrada sin factura ni ficha operativa);
  más warnings de HMR de Vite y de React Router future flags. Ningún error del flujo de firma.
- **Entorno restaurado**: reservas/clientes sembrados eliminados de `slotify_dev`; scripts `.cjs`
  temporales y el PDF de prueba borrados; frontend detenido. Capturas en `reports/e2e-screenshots/`
  (no en la raíz del repo).

## Resultado

**Step N+3: COMPLETADO** — flujo E2E verde en los 3 viewports, con verificación de BD real del
registro (DOCUMENTO firmado + flag + fecha + AUDIT `actualizar` sin transición). Sin bloqueantes.
