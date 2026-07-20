# QA E2E — presupuesto-confirmar-ux-e2-idioma

**Fecha:** 2026-07-20
**Entorno:** stack del worktree levantado en puertos alternativos (API `:3100` con `EMAIL_TRANSPORT=fake`, web `:5273`, `WEB_URL=http://localhost:5273`), contra la BD de desarrollo `slotify`. Playwright MCP desde la sesión principal. Login piloto `info@masialencis.com`.

## Flujo ejecutado

1. Alta de **consulta en catalán** (idioma `Català`), cliente «Flori», fecha 2026-12-15 → **26-0017** creada, fecha bloqueada, **E1 enviado automáticamente**.
2. Editar consulta: duración 8h, hora 18:00, 80 invitados (>50 → precio manual).
3. **Generar presupuesto** → datos fiscales + precio manual 5000 € → **Confirmar presupuesto** (estando scrolleado abajo, `scrollY=1394`).

## Resultados por fix

| Fix | Verificación | Resultado |
|-----|--------------|-----------|
| **A · Scroll** | `window.scrollY` tras confirmar | **0** (era 1394) — la vista sube al banner ✓ |
| **Banner éxito** | Visible arriba | «Presupuesto generado… pre-reserva… Se ha enviado el email al cliente con el presupuesto adjunto» ✓ |
| **C · Estado siempre visible** | Badge de la ficha | Muestra **«Pre-reserva»** (antes desaparecía) ✓ |
| **B · Refresco comunicaciones** | Listado tras confirmar, sin recargar | Aparecen **«Recordatorio (E2)»** y **«Confirmación de consulta (E1)»** al momento ✓ |
| **D · Idioma E2** | Asunto/idioma del E2 | «El teu pressupost per a l'esdeveniment (reserva 26-0017)» + `RESERVA.idioma='ca'` en BD ✓ |
| **E · Contenido E2** | Cuerpo E2 en BD (COMUNICACION) | Texto de marca catalán completo: «Moltes gràcies…», «40%», «Canoliart, SL», «condicions particulars», firma «Ari — Masia l'Encís» ✓ |

E1 también verificado en catalán (asunto «Hem rebut la teva consulta»).

## Responsive (regla dura)

Overflow horizontal `scrollWidth - clientWidth` de la ficha tras confirmar:
- **1280:** 0 px ✓
- **768:** 15 px — **deuda pre-existente del app-shell** (documentada); el badge «Pre-reserva» queda en right=682 < 753, no contribuye.
- **390:** overflow del app-shell (sidebar no colapsa a drawer) — **pre-existente en master** (se aborda en la rama de layout aparte). El contenido de la ficha (badge) hace wrap correctamente.

El cambio **no introduce overflow nuevo**.

## Estados terminales (ampliación aprobada por el usuario)

Al descartar la pre-reserva (limpieza), el estado pasa a `reserva_cancelada` (sin sub-estado). Se detectó que el `Badge` no etiquetaba los estados **terminales** (`reserva_cancelada`, `reserva_completada`), lo que contradecía «debería aparecer siempre el estado». **Decisión del usuario: incluirlos.** Se amplió `etiquetaEstadoPrincipal` (`lib/etiquetaEstado.ts`) con un mapa terminal (`reserva_cancelada → «Cancelada»`, `reserva_completada → «Completada»`), +2 tests en `Badge.test.tsx` (7/7 verde) y el spec-delta `pipeline-ui`.

**Verificación live:** tras el descarte, la ficha de 26-0017 (`reserva_cancelada`) muestra el badge **«Cancelada»** (captura `e2e-badge-terminal-cancelada.png`). ✓

## Limpieza de datos

- La reserva de prueba 26-0017 se **descartó** vía UI (acción de dominio): estado `reserva_cancelada`, **fecha 2026-12-15 liberada** (verificado: sin `FECHA_BLOQUEADA`). Quedan las COMUNICACION E1/E2 y el registro terminal, consistente con el resto de datos de prueba del entorno dev.
- Emails en modo **fake** (cero red): no se envió ningún correo real.

**Veredicto E2E:** los 5 fixes funcionan de extremo a extremo. Sin errores de consola en el flujo (salvo un 401 puntual por expiración de token durante una pausa, resuelto re-autenticando).
