# Change: mejoras-detalle-consulta

## Why

El uso real del **detalle de una consulta/reserva** (`FichaConsultaPage`, entregado por
US-051) ha revelado tres carencias que degradan la operativa del gestor. Se agrupan en un
único change por compartir superficie (la ficha de la RESERVA) y por ser cambios acotados
y de bajo acoplamiento entre sí:

1. **El desglose de invitados del detalle miente.** El detalle pinta tres filas —"Invitados
   (adultos y niños > 4)" (`numAdultosNinosMayores4`), "Niños ≤ 4" (`numNinosMenores4`) y
   "Nº de invitados final" (`numInvitadosFinal`)— pero **al crear una consulta solo se pide
   UN número de invitados** (se guarda en `numAdultosNinosMayores4`). Las otras dos filas
   salen SIEMPRE con el placeholder "De momento no se dispone de esta información", dando la
   falsa impresión de que faltan datos que nunca se piden. (Fuente: `US-051 §Punto 1`;
   `DetallesEvento.tsx`; spec viva `consultas` "Visualización completa de los detalles del
   evento en la ficha".)

2. **El campo `comentarios` del alta no se persiste ni se muestra, y la ficha operativa
   nace sin él.** Hoy `CreateReservaRequest.comentarios` SOLO decide el flujo del email E1
   (con comentarios → borrador manual; sin comentarios → auto-envío) y **no se guarda en
   ninguna columna**. La fila "Comentarios" del detalle lee en realidad `reserva.notas`
   (campo distinto, que el alta nunca rellena), así que el comentario que el cliente dejó al
   pedir la consulta se pierde. Además, cuando el gestor abre la **ficha operativa** del
   evento (nace vacía y lazy al confirmar el pago de señal, US-021), no tiene delante ese
   comentario. (Fuente: `US-051 §Punto 1`; `alta-consulta.use-case.ts §comentarios`;
   `CreateReservaRequest.comentarios`; `er-diagram §3.6 RESERVA`; `US-021`,
   `confirmar-pago-senal.use-case.ts §FICHA_OPERATIVA`.)

3. **El envío MANUAL del borrador E1 deja la ficha desincronizada.** Al revisar y enviar el
   borrador E1 (`RevisarEnviarBorradorDialog` → `useEnviarBorrador`), tras el éxito solo se
   invalida la query de comunicaciones, **no la de la reserva**, así que
   `tieneBorradorE1Pendiente` sigue `true` en caché y las acciones de la ficha quedan
   bloqueadas hasta salir y volver a entrar. Tampoco hay aviso de éxito arriba de la página
   ni scroll al inicio, a diferencia de la UX del E1 automático. (Fuente: `US-046`;
   `useEnviarBorrador.ts`; spec viva `comunicaciones` "Confirmación de envío de un
   borrador…"; `NuevaConsulta/components/AvisosResultado.tsx`.)

### Fuera de alcance (decisión de producto)

- **Editar `comentarios` vía `PATCH /reservas/{id}`.** El editor de consulta
  (`EditarConsultaDialog`) sigue tocando `notas`; `comentarios` es de **solo lectura** en
  el detalle (refleja lo que el cliente dijo al pedir la consulta). No se añade `comentarios`
  a `UpdateReservaRequest`.
- **No se retiran los campos `numNinosMenores4` / `numInvitadosFinal` del modelo ni del
  editor.** Siguen existiendo en la RESERVA, en `EditarConsultaDialog` y alimentando el
  aforo del Kanban/Listado (`lib/aforo.ts`); solo se retiran de la **vista de detalle**.
- **No se añade un campo nuevo a la ficha operativa.** La siembra reutiliza el
  `notasOperativas` existente.
- No cambia la lógica de decisión de E1 (la presencia de `comentarios` sigue decidiendo
  auto-envío vs. borrador), ni el transporte de email, ni el bloqueo atómico de fecha, ni la
  máquina de estados.

## What Changes

### Mejora 1 — Desglose de invitados del detalle (capability `consultas`) · Frontend puro
- El detalle de la ficha **deja de mostrar** las filas "Niños ≤ 4" (`numNinosMenores4`) y
  "Nº de invitados final" (`numInvitadosFinal`).
- La fila restante ("Invitados (adultos y niños > 4)", `numAdultosNinosMayores4`) se
  **renombra a "Invitados"**.
- Los campos siguen existiendo en el modelo, en `EditarConsultaDialog` y en el cálculo de
  aforo (`lib/aforo.ts`): el cambio es exclusivamente de **presentación del detalle**.

### Mejora 2 — Persistir, exponer y sembrar `comentarios` (capabilities `consultas`, `confirmacion`) · Backend + contrato + frontend
- **Persistencia**: `comentarios` pasa a ser columna propia de RESERVA
  (`comentarios String? @db.Text`, migración aditiva), poblada en el alta con el
  `comentarios` del `CreateReservaRequest`. La **lógica de decisión de E1 no cambia** (sigue
  mirando la presencia de `comentarios`).
- **Exposición**: `comentarios` se añade al schema de respuesta del detalle `ReservaDetalle`
  (`GET /reservas/{id}`), **solo en el detalle** — NO en el schema base `Reserva` ni en el
  listado.
- **Frontend**: la fila "Comentarios" del detalle lee `reserva.comentarios` (en vez de
  `notas`). Es de solo lectura.
- **Siembra en la ficha operativa**: al crearse la ficha operativa del evento (nace vacía y
  lazy en `pre_reserva → reserva_confirmada`, confirmación de pago de señal, US-021), su
  campo `notasOperativas` se **siembra** con el `comentarios` de la RESERVA si existe y no
  está en blanco. Si `comentarios` está ausente/vacío, `notasOperativas` nace `NULL` (como
  hoy). No se añade campo nuevo a la ficha operativa.

### Mejora 3 — Envío manual del borrador E1 refresca la ficha (capability `comunicaciones`) · Frontend puro
- Tras enviar el borrador con éxito, `useEnviarBorrador` invalida **también** la query de la
  reserva (`reservaQueryKey`), además de la de comunicaciones, para que
  `tieneBorradorE1Pendiente` se recalcule y las acciones de la ficha se **desbloqueen sin
  recargar**.
- La ficha muestra un **aviso de éxito arriba de la página** (banner verde, mismo patrón que
  el aviso del E1 automático en `AvisosResultado.tsx`) y hace **scroll al inicio**,
  replicando la UX del auto-envío.

### Contrato (lo ejecutará `contract-engineer` tras el gate)
- Añadir `comentarios` (`type: string, nullable: true`) al schema `ReservaDetalle` de
  `docs/api-spec.yml` (solo en el detalle; NO en `Reserva` base). Cambio aditivo.
- El SDK del frontend se **regenera** desde el contrato (nunca se edita a mano; hook
  `protect-generated-client`).

## Impact

- **Specs afectadas**:
  - `specs/consultas/spec.md` — MODIFIED "Visualización completa de los detalles del evento
    en la ficha" (invitados en una sola fila "Invitados"; "Comentarios" lee `comentarios`,
    no `notas`); ADDED "Persistencia y exposición de `comentarios` del alta en el detalle".
  - `specs/confirmacion/spec.md` — ADDED "Siembra de `notasOperativas` con `comentarios` al
    crear la ficha operativa".
  - `specs/comunicaciones/spec.md` — ADDED "El envío manual de un borrador refresca la ficha
    de la RESERVA (desbloqueo de acciones + aviso de éxito)".
- **Código afectado (tras el gate; no en este change)**:
  - Backend: migración `RESERVA.comentarios`; `AltaConsultaUseCase` persiste `comentarios`;
    `ConfirmarPagoSenalUseCase` / repositorio de ficha operativa siembra `notasOperativas`
    con `comentarios` al `crearVacia`; ambos con RLS por tenant.
  - Frontend: `DetallesEvento.tsx` (una fila "Invitados"; "Comentarios" ← `comentarios`);
    `useEnviarBorrador.ts` (invalidar `reservaQueryKey`); aviso de éxito + scroll en la ficha
    (patrón `AvisosResultado.tsx`).
  - Contrato: `ReservaDetalle.comentarios`; SDK regenerado.
- **NO reimplementa**: el transporte de email, la máquina de estados, el bloqueo atómico de
  fecha, ni la lógica de decisión de E1.
- **Riesgo principal**: bajo. El punto más sensible es la siembra dentro de la transacción de
  confirmación de pago de señal (US-021), que debe mantener la atomicidad e idempotencia
  existentes (`FICHA_OPERATIVA.reserva_id @unique`) → TDD del caso de uso primero.
