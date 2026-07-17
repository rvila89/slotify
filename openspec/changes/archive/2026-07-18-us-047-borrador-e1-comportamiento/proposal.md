# Change: us-047-borrador-e1-comportamiento

## Why

**US-047 — Refinamientos de comportamiento del borrador E1** (Área: Comunicaciones /
Consultas; Módulo M10; UC-35 / UC-36). US-046 implementó la revisión y el envío de
borradores de email desde la ficha de la RESERVA (E1 = confirmación de consulta que
US-045 deja en `estado = 'borrador'` cuando el alta incluye comentarios). El uso real
del flujo ha revelado cinco carencias de comportamiento que degradan la experiencia y
rompen una invariante de negocio:

1. **El gestor puede avanzar la consulta sin haber enviado el primer email al cliente.**
   Mientras el E1 sigue en `borrador`, el cliente **nunca ha recibido** la confirmación
   inicial; permitir transiciones (`2a → 2b`, programar visita, marcar descartada, etc.)
   deja al cliente sin el correo que da sentido al resto del ciclo. Sin el email inicial
   enviado, no tiene sentido avanzar la consulta.
2. **El enviar-borrador omite el dossier PDF que sí incluye el alta.** `AltaConsultaUseCase`
   (US-045, `R-Cableado real de E1 … dossier adjunto`) adjunta **siempre** el dossier del
   espacio según el idioma de la reserva; `EnviarBorradorUseCase` (US-046) NO lo hace, de
   modo que el mismo E1, enviado por la ruta manual, llega al cliente **sin el dossier**.
   Es una incoherencia funcional: el mismo email debe llevar el mismo adjunto por ambos
   caminos.
3. **El modal de revisión es estrecho** (`max-w-md` heredado) y dificulta leer y editar el
   cuerpo del email.
4. **La acción "Descartar borrador" confunde** al gestor sobre un E1 (la expectativa es
   enviarlo, no descartarlo); se retira de la UI. El endpoint backend se conserva.
5. **El gestor no ve, desde el dashboard, qué reservas tienen un E1 pendiente de enviar.**
   Debe abrir la ficha una a una para saberlo.

Resuelve el dolor D1 (comunicación reactiva supervisada por el gestor) y D3 (el sistema
pre-rellena y adjunta el dossier; el gestor solo revisa y confirma), reforzando la
trazabilidad y la coherencia del primer contacto con el cliente.

US-045 (**motor de email**, catálogo de plantillas E1 por idioma, adjunto de dossier en
el alta) y US-046 (**superficie HTTP de comunicaciones de la ficha**: listar, enviar
borrador con edición opcional, descartar, email manual) están **archivadas** (capabilities
`comunicaciones` y `consultas`, specs vivas). Esta historia **parte de su estado y
reutiliza sus puertos**: no reimplementa el transporte de email, el catálogo de plantillas,
el bloqueo atómico de fecha ni la máquina de estados de la RESERVA.

## What Changes

- **Bloqueo de acciones con E1 en borrador** (`consultas` / frontend `AccionesConsulta`):
  mientras exista una `COMUNICACION(codigo_email = 'E1', estado = 'borrador')` para la
  RESERVA, **todos** los botones de acción de `AccionesConsulta` se ocultan (no se
  renderiza el componente) y se muestra un aviso invitando a revisar y enviar el correo de
  confirmación antes de continuar. Afecta a **toda** `AccionesConsulta`, incluida "Marcar
  como descartada".
- **PDF adjunto al enviar un borrador E1** (`comunicaciones` / `EnviarBorradorUseCase`):
  al enviar un borrador cuyo `codigo_email === 'E1'`, el use-case adjunta **siempre** el
  dossier PDF del espacio según `reserva.idioma`, igual que `AltaConsultaUseCase`. Si
  `dossierBaseUrl` no está configurado, procede **sin** adjunto (degradación graceful,
  idéntica a la del alta). Reutiliza el mecanismo de adjunto por referencia de URL de
  US-045 (`Dossier-Masia-Encis-{idioma}.pdf`).
- **Dashboard alert de E1 pendiente** (`consultas` / pipeline):
  - `GET /reservas` (pipeline) incluye en cada ítem el flag `tieneBorradorE1Pendiente:
    boolean`, `true` cuando existe una `COMUNICACION(codigo_email = 'E1', estado =
    'borrador')` para esa RESERVA.
  - Las **kanban cards** y el **listado** muestran un badge ámbar "Borrador E1 pendiente"
    cuando `tieneBorradorE1Pendiente === true`. El flag se recalcula en cada fetch, de modo
    que al pasar el borrador a `enviado`/`fallido` desaparece automáticamente.
- **Modal más ancho** (`comunicaciones` / frontend `RevisarEnviarBorradorDialog`): usa
  `max-w-2xl` para facilitar la lectura y edición del cuerpo del email.
- **Eliminar "Descartar borrador" de la UI** (`comunicaciones` / frontend): se retira el
  botón "Descartar" de `ComunicacionListaItem.tsx` (y `ComunicacionesCard`), y se elimina
  el componente `DescartarBorradorDialog`. **El endpoint backend de descarte se conserva**
  (se mantiene la lógica y la spec viva de US-046), solo se deja de exponer en la UI.

### Entidades tocadas

- `COMUNICACION`: **sin cambios de estado ni de columnas** por parte de esta US. Solo se
  **lee** su existencia (`codigo_email = 'E1'`, `estado = 'borrador'`) para el flag del
  pipeline y el bloqueo de acciones; el envío del borrador sigue el camino de US-046
  (`borrador → enviado`/`fallido`) añadiendo únicamente el adjunto del dossier.
- `RESERVA`: **solo lectura** de `idioma` (ya persistido por el alta) para elegir el
  dossier. No se muta.
- `AUDIT_LOG`, `FECHA_BLOQUEADA`, `CLIENTE`: **NO se mutan**.

### Dependencia de datos

- Requiere el campo `idioma` en `RESERVA`, cuya **migración
  `20260717150000_add_idioma_horario_to_reserva` ya está en curso** (rama de trabajo). El
  use-case obtiene `reserva.idioma` de la reserva que ya carga para validar el envío; si
  el campo no estuviera presente, degrada al idioma por defecto (`'es'`) como hace el alta.

### Sin migración de esquema propia

Esta US **no** introduce migración de columnas ni de índices propia: el flag del pipeline
es un cálculo de consulta (existencia de borrador E1) y el adjunto reutiliza infraestructura
de US-045. La única dependencia de datos es la migración de `idioma` ya en curso.

### Trazabilidad

- **US**: `US-047` (bloqueo de acciones con E1 en borrador, PDF adjunto al enviar borrador
  E1, modal ancho, retirada de "Descartar" de la UI, dashboard alert de E1 pendiente).
- **UC**: UC-35 (respuesta inicial automática E1 / dossier), UC-36 (revisar y enviar
  borrador).
- **ER**: `er-diagram §3.17 COMUNICACION`, `§3.6 RESERVA` (`idioma`), `§CLIENTE`.
- **Depende de**: US-045 (motor de email, catálogo E1, adjunto de dossier — archivada),
  US-046 (superficie HTTP de comunicaciones, `EnviarBorradorUseCase` — archivada), y la
  migración `20260717150000_add_idioma_horario_to_reserva` (campo `RESERVA.idioma`).
- **Reutiliza** de la spec viva `comunicaciones`: "Cableado real de E1 personalizado por
  idioma, situación de fecha y dossier adjunto" (mecánica de adjunto), "Interfaz de
  adjuntos por referencia documental"; de `consultas`: "Idioma y horario opcionales en el
  alta de consulta" (`RESERVA.idioma`).

## Impact

- Specs afectadas:
  - `openspec/specs/consultas/spec.md` — ADDED: bloqueo de `AccionesConsulta` con E1 en
    borrador; `tieneBorradorE1Pendiente` en el ítem del pipeline; badge ámbar en kanban y
    listado.
  - `openspec/specs/comunicaciones/spec.md` — ADDED: adjunto del dossier al enviar un
    borrador E1 según `reserva.idioma` (con degradación graceful); modal de revisión a
    `max-w-2xl`. REMOVED: botón "Descartar" en la UI (endpoint backend conservado).
- Código (post-gate, fuera de este SDD):
  - Backend: `EnviarBorradorUseCase` adjunta el dossier E1; adapter de listado de reservas
    + `ReservaPipelineItemDto` con `tieneBorradorE1Pendiente`.
  - Contrato: `docs/api-spec.yml` (`tieneBorradorE1Pendiente` en `ReservaPipelineItemDto`)
    y regeneración del SDK (`apps/web/src/api-client/schema.d.ts`).
  - Frontend: `AccionesConsulta` (ocultar + aviso), `RevisarEnviarBorradorDialog`
    (`max-w-2xl`), `ComunicacionListaItem`/`ComunicacionesCard` (retirar Descartar) y
    eliminación de `DescartarBorradorDialog`, badge ámbar en `ReservaKanbanCard` y
    `ListadoView`.
- **Decisiones para visto bueno humano** (ver `design.md`): (D-1) `tieneBorradorE1Pendiente`
  en el pipeline DTO calculado en el mismo query; (D-2) origen de `idioma` desde la reserva
  ya cargada; (D-3) no re-render del cuerpo en el modal; (D-4) el bloqueo cubre toda
  `AccionesConsulta` incluido "Marcar como descartada"; (D-5) el flag se recalcula en cada
  fetch (sin persistencia dedicada).
