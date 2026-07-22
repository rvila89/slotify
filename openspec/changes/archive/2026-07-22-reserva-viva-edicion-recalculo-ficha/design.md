# Design — reserva-viva-edicion-recalculo-ficha

Decisiones técnicas no triviales del change. La spec (deltas) manda sobre el "qué"; aquí el
"cómo" y los porqués. Referencias de código verificadas en el worktree.

## D-1 — Mapeo ficha ↔ reserva (aforo y duración estructurados)

Los inputs de aforo y duración de la ficha operativa dejan de escribir los campos operativos
sueltos y pasan a editar los campos estructurados de la RESERVA:

| Ficha (hoy) | Pasa a editar en RESERVA |
|---|---|
| `numInvitadosConfirmado` (Int suelto, editable) | `numAdultosNinosMayores4` + `numNinosMenores4` (desglose, igual que el editor de consulta) |
| `duracion` (String texto libre) | `duracionHoras` (enum `DuracionHoras {h4→"4", h8→"8", h12→"12"}`) |

- El "nº de invitados confirmado" se convierte en **derivado read-only**:
  `derivarNumPersonas({ numInvitadosFinal, numAdultosNinosMayores4, numNinosMenores4 })` de
  `apps/api/src/presupuestos/domain/derivar-num-personas.ts` (ya usado por presupuestos; evita
  la deuda "aforo/personas es campo derivado" de la memoria del proyecto).
- `FICHA_OPERATIVA.numInvitadosConfirmado` y `FICHA_OPERATIVA.duracion` quedan como **columnas
  legacy no escritas** por esta vía (soft-deprecate, no se borran: mismo criterio que
  `menuSeleccionado`/`timingDetallado` en `ficha-operativa-campos-operativos`).
- El enum Prisma mapea a strings `"4"/"8"/"12"`; el dominio del motor de tarifa usa `number`
  `{4,8,12}` (`calculadora-tarifa.service.ts` `DURACIONES_VALIDAS`). El mapper hace la
  conversión (ya existe el patrón en `editar-presupuesto`/`generar-presupuesto`).

## D-2 — Pre-relleno completo al LEER (no solo al crear)

Hoy el pre-relleno solo ocurre al CREAR la ficha (siembra en `confirmar-pago-senal.use-case.ts`:
`contactoEventoCorreo` desde el cliente, `notasOperativas` desde `comentarios`). Se traslada la
lógica de "mostrar el dato existente si la ficha no tiene valor propio" al **caso de uso de
lectura** (`leer-ficha-operativa.use-case.ts` + su adaptador de carga
`cargar-reserva-con-ficha.prisma.adapter.ts`, que ya trae la RESERVA):

- Regla por campo: `valorFicha ?? valorDerivadoDeReservaOCliente`.
- Mapa: personas → `derivarNumPersonas`; `duracion` (presentación) ← `RESERVA.duracionHoras`;
  `horaLlegada` ← `RESERVA.horario`; `contactoEventoNombre` ← `CLIENTE.nombre + ' ' + apellidos`;
  `contactoEventoTelefono` ← `CLIENTE.telefono`; `contactoEventoCorreo` ← `CLIENTE.email`;
  `notasOperativas` ← `RESERVA.comentarios`.
- **Leer NO muta** (sin efectos, sin transición `pendiente→en_curso`): el pre-relleno es de
  presentación. El adaptador de carga debe incluir el JOIN a CLIENTE (hoy solo trae RESERVA);
  memoria "columna nueva → enhebrar todo el read path": projection → DTO → contrato → SDK →
  frontend.
- Al GUARDAR, el valor persiste y a partir de entonces prevalece sobre el derivado.

## D-3 — Guarda de ventana viva (declarativa)

Nueva función de guarda en `apps/api/src/reservas/domain/maquina-estados.ts`, junto a las
existentes (`esOrigenValidoParaEditarPresupuesto`, `esOrigenValidoParaConfirmarSenal`, …), como
ESTRUCTURA/función declarativa (skill `state-machine`, hook `no-infra-in-domain`):

```
esEditableEnVentanaViva(estado, preEventoStatus, liquidacionStatus): boolean =
  estado === 'reserva_confirmada'
  && preEventoStatus !== 'cerrado'
  && liquidacionStatus !== 'cobrada'
```

- No es una arista de la máquina de estados (no cambia `estado`), sino una **guarda de
  editabilidad**, igual que `esEstadoValidoParaEditarPresupuesto` o `esDiaDelEvento` (ya
  presentes como funciones puras). Se ubica en el mismo módulo para no dispersar `if`.
- Falla la guarda → error de dominio tipado (`FueraDeVentanaVivaError`, `codigo` propio) → **422**
  (consistente con las guardas de estado del proyecto).
- Solo aplica al cambio de **aforo/duración con recálculo**. Los campos operativos no
  estructurales (contacto, hora, notas, briefing) siguen su guarda de acceso de US-025
  (`permiteAccederFicha`), sin esta restricción, incluida la edición post-cierre.

## D-4 — Orden del recálculo transaccional (idempotente, all-or-nothing)

Nuevo caso de uso `RecalcularReservaVivaUseCase` (application, hexagonal: solo puertos). Se
invoca desde el guardado de la ficha cuando cambia aforo/duración y la guarda D-3 pasa. Orden:

0. **Guardas SÍNCRONAS previas** (sin efectos): existencia + RLS (404), guarda de ventana viva
   D-3 (422), validación de `duracionHoras ∈ {4,8,12}` y desglose ≥ 0 (400/422).
1. **Calcular el nuevo total** con `CalculadoraTarifaService.calcular({ fechaEvento,
   duracionHoras, numAdultosNinosMayores4, extras: RESERVA_EXTRA vigentes })`. Extras vigentes =
   `factura_id IS NULL` (mismo criterio que la liquidación). `> 50` o `TarifaNoConfigurada` →
   **`tarifaAConsultar`** → exige `precioManualEur` (mismo contrato que
   `EditarPresupuestoUseCase.confirmar`).
2. En **UNA transacción (tx + RLS)**:
   a. Nueva versión de PRESUPUESTO de modificación (`version = MAX+1`, inmutable), reintento
      acotado ante `P2002` de `@@unique([reservaId, version])` (patrón `editar-presupuesto`,
      `MAX_REINTENTOS_VERSION`). Sin locks distribuidos (hook `no-distributed-lock`).
   b. Persistir el desglose estructurado en la RESERVA (`duracionHoras`,
      `numAdultosNinosMayores4`, `numNinosMenores4`).
   c. **Re-congelar** `RESERVA.importe_total = nuevo_total`,
      `importe_liquidacion = nuevo_total − importe_senal`. **`importe_senal` intacto.**
   d. **Regenerar** la FACTURA `tipo='liquidacion'` (buscar por `(reserva_id, tipo)`): reescribir
      `total`/desglose con `calcularTotalLiquidacion({ importeLiquidacion, subtotalesExtras
      Pendientes })` + `calcularDesgloseFactura`. Se permite si estado ∈ {`borrador`,`enviada`};
      NO si `cobrada` (imposible bajo la guarda). Sin duplicar (idempotente por
      `(reserva_id, tipo)`).
   e. `AUDIT_LOG` de cada mutación (`actualizar` RESERVA/PRESUPUESTO/FACTURA).
3. **Post-commit** (fuera de la tx, no revierte): regenerar PDF del presupuesto de modificación +
   enviar email de modificación (D-6). Fallo → COMUNICACION `fallido` reintentable.

Idempotencia: reaplicar con el mismo aforo/duración recomputa el mismo total y reescribe los
mismos importes; una nueva versión de presupuesto es aceptable (historial) pero los importes
congelados y la liquidación convergen al mismo estado. **Deuda a vigilar** (memoria "importe_total
nunca escrito"): asegurar que el test de integración NO siembre `importe_total` a mano, que lo
escriba el propio recálculo.

## D-5 — Presupuesto de modificación: pago inicial fijo + restante

- No reutiliza `calcularReparto` (que aplica `pctSenal` sobre el total). En su lugar, dos
  importes derivados: `pagoInicial = RESERVA.importe_senal` (congelado, NO recalculado) y
  `liquidacionRestante = nuevo_total − importe_senal`.
- Se marca la versión como "de modificación" (flag/`origen`) para que el render del PDF y del
  email use la variante correcta (dos líneas: "Pago inicial ya realizado" + "Liquidación
  restante") en vez del reparto 40/60.
- `tarifaAConsultar`: `nuevo_total = precioManualEur`; el restante se deriva igual.
- El desglose fiscal por régimen (con IVA / sin IVA) reutiliza `calcularDesgloseFiscal`/
  `calcularDesgloseFactura` (US-014/US-022): el restante es un total con IVA incluido igual que
  hoy.

## D-6 — Plantilla de email i18n (modificación)

- El catálogo `catalogo-plantillas.ts` indexa por `codigoEmail` + idioma (`renderE2`/`renderE2Ca`,
  `renderE3`/`renderE3Ca`), con fallback a `es` + AUDIT_LOG cuando falta la variante.
- Se añade un **código de email dedicado** (p. ej. **E9** "modificación de reserva") al enum
  `CodigoEmail` (Prisma `enum CodigoEmail` + `codigo-email.ts` union de literales) y dos render:
  `renderE9` (es) y `renderE9Ca` (ca). Variables: `{nombre}`, `{codigoReserva}`, qué cambió
  (personas/duración), `{liquidacionRestante}`. Adjunto: PDF del presupuesto de modificación
  (patrón E2).
- Alternativa considerada y descartada: reusar E2 con una marca `esModificacion`. Se descarta
  porque E2 es el email de "presupuesto/edición en pre_reserva" y mezclar semánticas complica la
  trazabilidad de COMUNICACION; un código propio es más limpio y coherente con E1–E8.
- Envío por el motor de US-045 (`despachar-email.service`), post-commit, idioma = `RESERVA.idioma`.

## D-7 — Edge cases

- **> 50 invitados / sin tarifa configurada** → `tarifaAConsultar`, TOTAL manual obligatorio
  (`PrecioManualRequeridoError` 422 si falta), restante derivado del total manual.
- **`TemporadaNoConfigurada`** → 422 (propagado del motor), sin mutar nada.
- **Idempotencia / doble clic** → tx única + reintento acotado `P2002` de versión; el re-congelado
  y la regeneración de liquidación son idempotentes por `(reserva_id, tipo)`.
- **Concurrencia** con el barrido de cierre de ficha T-1d (US-026) o con el cobro de liquidación
  (US-029): la guarda D-3 se re-evalúa DENTRO de la tx (lectura de `pre_evento_status`/
  `liquidacion_status` bajo la tx) para rechazar el recálculo si la ficha se cerró o la
  liquidación se cobró entre la guarda previa y el commit. Sin locks distribuidos.
- **Sin cambio real** (mismo aforo/duración que el vigente) → no se dispara recálculo (no-op:
  no versiona, no reenvía email). Evita spam de presupuestos.
- **`importe_senal` nulo** (no debería en `reserva_confirmada`, pero defensivo) → tratar como
  frontera dura: si no hay señal congelada, no se puede derivar el restante → 422.
- **FECHA del evento**: intocable aquí; el motor de tarifa la usa como input de solo lectura para
  la temporada.

## D-8 — Hexagonal / guardrails

- `domain/` puro (guarda D-3, helpers de recálculo): sin `@nestjs/*` ni Prisma
  (`no-infra-in-domain`).
- `application/` orquesta puertos (motor de tarifa, UoW, repos tx-bound de presupuesto/factura/
  reserva/auditoría, disparo de email post-commit), espejo de `editar-presupuesto.use-case.ts` y
  `confirmar-pago-senal.use-case.ts`.
- Sin Redis/Redlock (`no-distributed-lock`): idempotencia por unicidad + reintento acotado.
- Contrato primero (SDK regenerado por `contract-engineer`); el frontend consume por el barrel de
  `features/ficha-operativa`.
