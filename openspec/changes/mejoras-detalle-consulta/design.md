# Design — mejoras-detalle-consulta

> Tres mejoras acotadas al detalle de una consulta/reserva, agrupadas por compartir la
> superficie de la ficha (`FichaConsultaPage`). Ninguna toca el bloqueo atómico de fecha ni
> la máquina de estados. La única decisión sensible es la siembra dentro de la transacción de
> confirmación de señal (US-021), que debe preservar atomicidad e idempotencia.

## D-1 · Mejora 1: invitados en una sola fila (frontend puro, sin migración)

Hoy `DetallesEvento.tsx` pinta tres filas de invitados (`numAdultosNinosMayores4`,
`numNinosMenores4`, `numInvitadosFinal`), pero el alta solo captura **un** número
(persistido en `numAdultosNinosMayores4`), de modo que "Niños ≤ 4" y "Nº de invitados final"
salen SIEMPRE con el placeholder de ausente.

- Se retiran del **detalle** las filas "Niños ≤ 4" y "Nº de invitados final". La fila
  restante se renombra de "Invitados (adultos y niños > 4)" a **"Invitados"**.
- **No es una eliminación de datos**: `numNinosMenores4` y `numInvitadosFinal` siguen en el
  modelo Prisma, en `EditarConsultaDialog` y alimentando el aforo del Kanban/Listado
  (`lib/aforo.ts`). Solo cambia la **presentación del detalle**. No hay migración ni cambio
  de contrato para esta mejora.

## D-2 · Mejora 2: persistir, exponer y sembrar `comentarios`

### D-2.1 · Persistencia (backend + migración aditiva)

Hoy `comentarios` (`CreateReservaRequest.comentarios`) solo se usa en memoria en
`AltaConsultaUseCase` para decidir el flujo de E1 (`tieneComentarios()`): auto-envío vs.
borrador. No se guarda en ninguna columna, y la fila "Comentarios" del detalle lee
`reserva.notas`, que el alta nunca rellena.

- Nueva columna **`RESERVA.comentarios String? @db.Text`** (migración **aditiva**, nullable;
  no rompe datos existentes). Poblada en la transacción del alta con
  `comando.comentarios` (trim; vacío → `NULL`).
- **La lógica de decisión de E1 NO cambia**: `tieneComentarios()` sigue mirando la presencia
  del `comentarios` entrante. La persistencia es un efecto añadido, no un cambio de flujo.
- `comentarios` y `notas` son **campos distintos y coexisten**: `comentarios` = lo que el
  cliente dijo al pedir la consulta (solo lectura en el detalle); `notas` = notas internas
  del gestor, editables por el `PATCH /reservas/{id}` (US-051). No se fusionan.

### D-2.2 · Exposición (contrato: solo en `ReservaDetalle`)

- Añadir `comentarios: { type: string, nullable: true }` **al schema `ReservaDetalle`** de
  `docs/api-spec.yml`, no al schema base `Reserva`. Motivo: el comentario solo se consume en
  la vista de detalle; mantenerlo fuera del `Reserva` base evita cargarlo en el listado, el
  pipeline y el histórico (que reutilizan/derivan del base). Cambio **aditivo** (opcional).
- El SDK del frontend se **regenera** desde el contrato (nunca a mano; hook
  `protect-generated-client`). Lo ejecuta `contract-engineer` tras el gate.
- Frontend: `DetallesEvento.tsx` cambia `reserva.notas` → `reserva.comentarios` en la fila
  "Comentarios". Solo lectura.

### D-2.3 · Siembra en la ficha operativa (la parte más sensible)

La ficha operativa nace **vacía y lazy** dentro de la transacción de confirmación de pago de
señal (`ConfirmarPagoSenalUseCase` → `fichaOperativa.crearVacia`,
`confirmar-pago-senal-uow.prisma.adapter.ts`), `pre_reserva → reserva_confirmada` (US-021).

- Al crearla, **sembrar `notasOperativas`** con `RESERVA.comentarios` si existe y no está en
  blanco (tras `trim`); si no, `notasOperativas` nace `NULL` como hoy.
- **No se añade campo nuevo** a la ficha operativa: se reutiliza `notasOperativas` (que hoy
  nace `NULL`). El único caso de test que hoy asume `notasOperativas === null` incondicional
  (`confirmar-pago-senal-integracion.spec.ts:286`) debe actualizarse a "null solo si la
  reserva no tenía comentarios".
- **Restricciones críticas que se preservan**:
  - **Atomicidad**: la siembra es un `data.notasOperativas` en el mismo `create` dentro de la
    transacción; no añade round-trips ni efectos post-commit. All-or-nothing intacto.
  - **Idempotencia**: si la ficha ya existe (`reserva_id @unique`), NO se re-siembra ni se
    sobreescribe el `notasOperativas` existente; se detecta y no se duplica (comportamiento
    US-021 sin cambios).
  - **RLS/tenant**: la siembra corre bajo `fijarTenant(tenantId)` de la UoW existente.
- `crearVacia` pasa a aceptar el `comentarios` (o el gestor lo lee de la RESERVA ya cargada
  dentro de la transacción). La firma exacta la fija `backend-developer`; la spec solo exige
  el efecto observable. TDD del caso de uso primero (con y sin comentarios + idempotencia).

## D-3 · Mejora 3: refresco de la ficha tras envío manual del borrador (frontend puro)

Hoy `useEnviarBorrador` (`onSuccess`) solo invalida
`comunicacionesReservaQueryKey(reservaId)`. El flag `tieneBorradorE1Pendiente` se deriva de
la RESERVA (query separada), que NO se invalida, así que sigue `true` en caché y las acciones
quedan bloqueadas hasta salir/entrar de la ficha. Además no hay aviso arriba ni scroll.

- `onSuccess` invalida **también** `reservaQueryKey(reservaId)` (además de comunicaciones)
  para recalcular `tieneBorradorE1Pendiente` y desbloquear las acciones sin recargar.
- La ficha muestra un **aviso de éxito arriba** (banner verde, patrón de
  `AvisosResultado.tsx`) y hace **scroll al inicio** al confirmarse el envío, replicando la
  UX del auto-envío del E1.
- Es UI: NO cambia el contrato ni el comportamiento de servidor del envío (US-046). Los
  desenlaces de error (422/409/502) mantienen su tratamiento actual (no muestran aviso de
  éxito; el 409/502 ya invalidan comunicaciones).

## D-4 · Por qué un único change

Las tres mejoras comparten la superficie del **detalle de la consulta** y son de bajo
acoplamiento y bajo riesgo. Agruparlas evita tres ciclos SDD→gate→QA→PR para cambios que un
mismo gestor valida de una pasada en la misma ficha. La única con lógica de dominio (Mejora
2) queda aislada por sus propios tests; las otras dos son frontend puro.

## Trazabilidad

- US: `US-051` (detalle de la ficha, Mejoras 1 y 2 exposición/frontend), `US-021`
  (confirmación de señal + ficha operativa, Mejora 2 siembra), `US-046` (revisar/enviar
  borrador, Mejora 3).
- UC: UC-17/UC-20 (ficha operativa), UC-36 (envío manual del borrador).
- ER: `er-diagram §3.6 RESERVA` (`comentarios`, `notas`), `§3.14 FICHA_OPERATIVA`
  (`notas_operativas`).
- Specs vivas: `consultas` ("Visualización completa de los detalles del evento en la ficha",
  "Las acciones de la consulta se bloquean mientras el E1 sigue en borrador"), `confirmacion`
  ("Creación idempotente de la FICHA_OPERATIVA vacía"), `comunicaciones` ("Confirmación de
  envío de un borrador…").
- `CLAUDE.md §Arquitectura` (hexagonal), `§Multi-tenancy`, `§Regla crítica: bloqueo atómico
  de fecha` (no se toca), `§Máquina de estados` (no se toca).
