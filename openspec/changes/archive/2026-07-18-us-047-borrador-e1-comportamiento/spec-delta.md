# Spec Delta — Índice (US-047)

> Los deltas ejecutables (los que valida `openspec validate --strict`) viven en
> `specs/<capability>/spec.md` de este change, siguiendo la convención de OpenSpec y del
> proyecto (`openspec/project.md §Cómo trabajamos`). Este archivo es solo un índice legible
> de qué requirements se añaden/modifican y en qué capability, con su identificador
> nemotécnico. La fuente de verdad para el validador son los ficheros enlazados abajo.

## `openspec/specs/consultas/spec.md` → [`specs/consultas/spec.md`](specs/consultas/spec.md)

- **ADDED `R-BORRADOR-E1-BLOQUEO`** — "Las acciones de la consulta se bloquean mientras el
  E1 sigue en borrador": mientras exista `COMUNICACION(codigo_email = 'E1', estado =
  'borrador')` para la RESERVA, `AccionesConsulta` no se renderiza y se muestra el aviso
  "Revisa y envía el correo de confirmación antes de continuar." Cubre toda
  `AccionesConsulta`, incluida "Marcar como descartada".
- **ADDED `R-BORRADOR-E1-PIPELINE`** — "El ítem del pipeline expone si la reserva tiene un
  borrador E1 pendiente": `ReservaPipelineItemDto` incluye
  `tieneBorradorE1Pendiente: boolean`, calculado en el query del pipeline bajo RLS y
  recalculado en cada fetch.
- **ADDED `R-BORRADOR-E1-DASHBOARD`** — "El kanban y el listado señalan la reserva con un
  badge de E1 pendiente": las cards del kanban y las filas del listado muestran un badge
  ámbar "Borrador E1 pendiente" cuando `tieneBorradorE1Pendiente === true`.

## `openspec/specs/comunicaciones/spec.md` → [`specs/comunicaciones/spec.md`](specs/comunicaciones/spec.md)

- **ADDED `R-E1-BORRADOR-PDF`** — "El envío de un borrador E1 adjunta el dossier PDF según
  el idioma de la reserva": `EnviarBorradorUseCase` detecta `codigoEmail === 'E1'` y adjunta
  el dossier según `reserva.idioma`; si `dossierBaseUrl` no está configurado, procede sin
  adjunto (degradación graceful igual que `AltaConsultaUseCase`).
- **ADDED `R-MODAL-ANCHO`** — "El modal de revisión del borrador usa un ancho amplio para
  leer el cuerpo": `RevisarEnviarBorradorDialog` usa `max-w-2xl`, responsive y sin overflow.
- **MODIFIED `R-DESCARTAR-BORRADOR-UI`** — "Descarte de un borrador por el gestor lo lleva a
  fallido sin envío y con causa auditada" (requirement vivo de US-046): se **retira el botón
  "Descartar" de la UI** (`ComunicacionListaItem`/`ComunicacionesCard`, se elimina
  `DescartarBorradorDialog`) **conservando el endpoint backend** y toda su lógica/auditoría.
  > Nota de método: la petición original planteaba un `REMOVED R-DESCARTAR-BORRADOR-UI`. En
  > OpenSpec un `REMOVED` elimina el requirement completo de la spec viva, lo que borraría
  > también la capacidad backend que debe **conservarse**. Como la spec viva no tiene un
  > requirement UI-only separable, la retirada del botón se modela como **MODIFIED** del
  > requirement de descarte de US-046, añadiendo la regla "no se expone en la UI, el
  > endpoint se mantiene". El efecto de negocio pedido (sin botón en UI, backend intacto) se
  > cumple sin destruir comportamiento backend.
