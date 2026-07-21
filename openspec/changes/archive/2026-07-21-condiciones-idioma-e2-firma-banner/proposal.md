# Change: condiciones-idioma-e2-firma-banner

## Why

El uso real de la ficha de reserva confirmada ha revelado tres carencias relacionadas con
las condiciones particulares y su UX, agrupadas aquí por compartir superficie (entidad
`RESERVA` + feature `condiciones-firmadas`) y ser cambios de bajo acoplamiento entre sí:

**1. El PDF de condiciones siempre sale en catalán** aunque `RESERVA.idioma` sea `'es'`.

El JSON `PlantillaDocumentoTenant.condiciones` ya almacena estructura bilingüe
(`titulo.{es,ca}`, `secciones[].{titulo,cuerpo}.{es,ca}`) desde la migración
`20260720120000_documento_textos_bilingues`, pero `PdfCondicionesRealAdapter` pasa la
`ConfiguracionDocumentoTenant` completa al renderizador **sin indicar qué idioma usar** y
el renderizador hardcodea catalán. La clave de almacenamiento `condiciones/{tenantId}.pdf`
tampoco diferencia por idioma, por lo que dos reservas del mismo tenant con idiomas
distintos reutilizarían el mismo PDF. Fuente: `pdf-condiciones.real.adapter.ts`;
`generar-pdf-condiciones.port.ts`; spec viva `documentos`.

**2. Las condiciones se envían en E3 en lugar de en E2.**

La intención de producto es que el cliente reciba las condiciones particulares **con el
presupuesto** (E2), para que pueda revisarlas antes de decidir confirmar la reserva. La
implementación actual las adjunta en E3 (confirmación + factura de señal). El guard duro
`CondicionesNoConfiguradasError` (409) vive en `EnviarFacturaSenalUseCase` y bloquea la
confirmación de la reserva si el tenant no ha configurado condiciones. `DispararE2Adapter`
ya genera condiciones de forma oportunista (fire-and-forget, sin guard duro, sin fijar
`cond_part_enviadas_fecha`) — lo que confirma el sitio correcto, pero incompleto. La UI en
`CondicionesFirmadasCard.tsx:77` referencia explícitamente "(E3)". Fuente:
`enviar-factura-senal.use-case.ts §b-1b`; `disparar-e2.adapter.ts`; spec viva
`confirmacion`, `presupuestos`.

**3. Registrar la firma muestra un toast Sonner en lugar de un banner inline.**

Todas las demás acciones de desenlace de la ficha (enviar señal, confirmar presupuesto,
descarte, E1 manual…) muestran un banner verde inline arriba de la página + scroll al
inicio, gestionados por `useAvisosFicha` + `AvisosFicha`. La tarjeta
`CondicionesFirmadasCard` es autónoma: su callback `onRegistrado` llama directamente a
`notify.success()` sin pasar por el sistema de avisos. Fuente:
`CondicionesFirmadasCard.tsx:150-156`; `useAvisosFicha.ts`; spec viva `ficha-consulta-ui`.

---

## What Changes

### Mejora A — Idioma correcto en el PDF de condiciones (capability `documentos`)

> Alineación del PDF generado con el idioma registrado de la comunicación con el cliente.

- `GenerarPdfCondicionesPort.generar` añade `idioma: 'es' | 'ca'` al objeto `params`.
- `PdfCondicionesRealAdapter` recibe `idioma`, lo pasa al renderizador y usa clave de
  almacenamiento diferenciada: `condiciones/{tenantId}-{idioma}.pdf`.
- `RenderizarDocumentoCondiciones` (tipo inyectado) recibe `idioma` y selecciona el texto
  del JSON bilingüe (`titulo.{idioma}`, `secciones[].{cuerpo/titulo}.{idioma}`).
- Todos los llamantes pasan `reserva.idioma`. Tras la Mejora B, el único llamante es
  `DispararE2Adapter`, que ya lee `reserva.idioma` de la BD.

### Mejora B — Condiciones en E2, no en E3 (capabilities `presupuestos`, `comunicaciones`, `confirmacion`)

> El cliente recibe las condiciones con el presupuesto (E2), no con la factura de señal
> (E3). El guard duro se mueve de E3 a E2.

- **`generar-presupuesto.use-case.ts` — `confirmar()`**: añade guarda pre-tx contra el
  tenant sin condiciones (llama a `generarCondicionesPort.generar({ tenantId, idioma })`
  antes de la tx; `null` → 409 `CONDICIONES_NO_CONFIGURADAS`). Dentro de la tx, fija
  `RESERVA.cond_part_enviadas_fecha = now()` y `cond_part_firmadas = false`.
  La generación real del PDF (con subida al almacén) ocurre post-commit, en
  `DispararE2Adapter`, igual que hoy, pero ahora con `idioma` y sin swallow de null
  (si degrada post-guard es un fallo transitorio).
- **`DispararE2Adapter`**: pasa `idioma: reserva.idioma` al llamar a
  `generarCondiciones.generar()`.  El swallow de `null` pasa a ser solo para fallos
  transitorios de render/subida (no para "sin config", que ya se descartó en la guarda).
- **`EnviarFacturaSenalUseCase` (E3)**: elimina completamente:
  - La llamada a `generarCondiciones` y su guarda `CondicionesNoConfiguradasError`.
  - El adjunto `condiciones` del array de adjuntos de E3.
  - La llamada a `repos.reservas.fijarCondicionesEnviadas()`.
  - La dependencia `GenerarCondicionesPort` de las deps del use case.
  - La persistencia idempotente del `DOCUMENTO condiciones_particulares` (se traslada a
    E2 si aplica, o se genera en la primera visita a la URL si el almacén es idempotente).
- **`CondicionesFirmadasCard.tsx:77`**: actualiza el texto de aviso:
  `"(E3)"` → `"(E2)"`.

### Mejora C — Firma registrada → banner inline + scroll top (capability `ficha-consulta-ui`)

> Alineación con el patrón de UX de desenlace del resto de acciones de la ficha.

- Nuevo componente `features/condiciones-firmadas/components/AvisoCondicionesFirmadas.tsx`:
  banner verde (`border-emerald-200 bg-emerald-50`), `CheckCircle2`, texto diferenciado
  por tipo (`'registrada'` vs `'reregistrada'`), botón cerrar, patrón idéntico a
  `AvisoPresupuestoConfirmado`.
- `useAvisosFicha.ts`: nuevo estado `firma: 'registrada' | 'reregistrada' | null` +
  `mostrarFirma(tipo)` + limpieza de `firma` en `cerrar()`.
- `AvisosFicha.tsx` + `Props`: acepta `firma` y `onCerrarFirma`; renderiza
  `AvisoCondicionesFirmadas` cuando activo.
- `CondicionesFirmadasCard.tsx`: acepta prop opcional
  `onRegistrado?: (tipo: 'registrada' | 'reregistrada') => void`; el callback interno
  deja de llamar `notify.success()` y llama a la prop en su lugar (o a notify como
  fallback si la prop no se pasa, para no romper usos sin contexto de ficha).
- `SeccionesFicha.tsx`: prop-drill de `onRegistrado` hacia `CondicionesFirmadasCard`.
- `FichaConsultaPage.tsx`: callback `onRegistrado` que invoca
  `avisos.mostrarFirma(tipo)` + `window.scrollTo({ top: 0, behavior: 'smooth' })`.

---

## Impact

- **Specs afectadas**:
  - `openspec/specs/documentos/spec.md` — MODIFIED `GenerarPdfCondicionesPort` y
    `PdfCondicionesRealAdapter` para idioma.
  - `openspec/specs/comunicaciones/spec.md` — MODIFIED E2 (adjunta condiciones con idioma
    + guard duro + `cond_part_enviadas_fecha`); MODIFIED E3 (ya no adjunta condiciones ni
    fija `cond_part_enviadas_fecha`).
  - `openspec/specs/presupuestos/spec.md` — MODIFIED confirmar presupuesto: guard duro
    condiciones + `cond_part_enviadas_fecha` dentro de la tx.
  - `openspec/specs/confirmacion/spec.md` — MODIFIED `EnviarFacturaSenalUseCase`: sin
    lógica de condiciones.
  - `openspec/specs/ficha-consulta-ui/spec.md` — MODIFIED registrar firma: banner + scroll,
    no toast.
- **Contrato/SDK**: sin cambio de surface de la API pública (el endpoint de envío de
  presupuesto ya devuelve `Reserva`; `condPartFechaEnvio` ya existe en el schema
  `ReservaDetalle`). Si el endpoint de confirmar presupuesto no devuelve
  `condPartFechaEnvio`, se añade como campo aditivo (cambio no rompiente).
- **BD**: sin migración. `cond_part_enviadas_fecha` ya existe en `RESERVA` (se añadió para
  E3). El cambio es solo en quién la fija (E2 en lugar de E3).
- **Riesgo**: bajo. El punto más sensible es el guard pre-tx en
  `generar-presupuesto.use-case.ts`: debe llamar a `generarCondicionesPort` con `idioma`
  antes de la transacción para verificar que el tenant tiene condiciones configuradas, sin
  efecto secundario (no sube el PDF aún en esa fase; la generación+subida real sigue en
  `DispararE2Adapter` post-commit). El otro riesgo es que tests existentes de E3 esperan
  condiciones adjuntas: deben actualizarse para no esperar ese adjunto.
- **No rompe**: el endpoint `POST /reservas/{id}/condiciones-firmadas` no cambia su
  contrato ni su guard (sigue comprobando `cond_part_enviadas_fecha IS NOT NULL`; ahora
  ese campo se rellena con E2 en lugar de E3, pero el guard lógico es idéntico).
