# Change: consulta-fecha-borrador-fix

## Why (contexto y problema)

Al crear una **consulta exploratoria `2a`** (sin fecha) y gestionarla, el gestor vive una
experiencia rota. El origen es la **asignación de fecha** (US-005) y su **borrador de
correo E1** en estado `borrador` (US-047 + change archivado `email-transicion-fecha-borrador`).
Todos los defectos están verificados en código:

1. **Botón "Editar consulta" duplicado**: `AccionEditarConsulta` se renderiza siempre en
   `estado==='consulta'`, y `AccionPresupuesto` renderiza un segundo "Editar consulta"
   idéntico cuando faltan datos.
   (`apps/web/src/features/reservas/pages/FichaConsulta/components/AccionEditarConsulta.tsx`,
   `.../AccionPresupuesto.tsx`, `.../AccionesConsulta.tsx`.)
2. **Borrador E1 invisible tras asignar/cambiar fecha**: por diseño (US-047) la transición
   de fecha crea la `COMUNICACION` E1 en `borrador` (no se autoenvía; spec viva `consultas`
   "Email de confirmación de bloqueo provisional vía el motor de US-045"). Pero las
   mutaciones de fecha del frontend solo invalidan el query de la reserva, **no** el de
   comunicaciones → el borrador nunca se muestra → no se puede enviar → las acciones quedan
   bloqueadas sin salida (ver defecto 5).
3. **Alert verde FALSO**: el aviso del resultado de la transición de fecha
   (`AvisosTransicion.tsx`) dice *"Se ha enviado un email de confirmación al cliente"*
   cuando el correo quedó en **borrador**. Contradice la spec viva `consultas` "Email de
   confirmación… NO enviarla automáticamente". Debe ser un aviso **ámbar** ("pendiente de
   revisión y envío"), no verde de éxito.
4. **Sin scroll al aviso**: tras asignar/cambiar fecha no hay scroll-to-top; el gestor no
   ve el aviso.
5. **Bloqueo total de acciones** con borrador E1 pendiente (`tieneBorradorE1Pendiente`):
   hoy la spec viva `consultas` "Las acciones de la consulta se bloquean mientras el E1
   sigue en borrador" oculta **todas** las acciones. El gestor no puede introducir
   personas/horario/duración, que son precisamente los datos que el borrador necesita
   (placeholder `___`). Debe poder **EDITAR** la consulta (y **gestionar la fecha**)
   mientras el borrador esté pendiente, y que esos cambios se **reflejen en el borrador**.
   El resto de acciones downstream (presupuesto, visita, descartar…) siguen bloqueadas
   hasta enviar el E1.
6. **Asunto del borrador E1 (rama "disponible", `2a→2b`)**: hoy *"La fecha que propones
   está disponible"* (`plantilla-transicion-fecha.ts`); debe ser **"Pre-reserva
   confirmada"**. La rama "cola" (`2a→2d`) no cambia.
7. **Formato del email al enviarse**: el cuerpo (texto plano con `\n`) se envía como `html:`
   sin convertir — `ResendEmailAdapter.enviar` hace `html: comando.cuerpo, text:
   comando.cuerpo` (`resend.email.adapter.ts:49-50`) → el cliente colapsa los saltos de
   línea. El catálogo (`catalogo-plantillas.ts:80-83`) **sí** convierte `\n\n→<p>` y
   `\n→<br>` con escape; la plantilla de transición (`plantilla-transicion-fecha.ts`) **no**.

## Decisiones ya tomadas (NO reabrir — fijadas por el usuario)

- **Correo E1: MANUAL con revisión** (se mantiene US-047). El fix hace **visible** el
  borrador; el gestor lo revisa/edita y **envía**; al enviarlo se **desbloquean** las
  acciones downstream.
- **Botones**: separar la **gestión de fecha** (flujo atómico + correo) de la **edición de
  campos** (`PATCH`, sin correo). Un **único** "Editar consulta". El modal de editar
  **deja de contener** la sección de fecha. Junto a "Generar presupuesto" bloqueado se
  muestra el **CTA que resuelve el bloqueo** (revisar/enviar el borrador E1).

## What Changes (alcance)

### Capability `consultas`
- **MODIFIED** "Las acciones de la consulta se bloquean mientras el E1 sigue en borrador":
  con borrador E1 pendiente se permite **editar la consulta** y **gestionar la fecha**; el
  resto de acciones downstream siguen bloqueadas hasta enviar el E1.
- **MODIFIED** "Edición de los datos de una consulta/reserva": si existe borrador E1
  pendiente, tras el `PATCH` se **regenera** el asunto/cuerpo del borrador con los datos
  actualizados (sin guarda 409: editar SÍ está permitido).
- **MODIFIED** "Email de confirmación de bloqueo provisional vía el motor de US-045": el
  aviso de resultado de la transición comunica **"borrador de confirmación pendiente de
  revisión/envío"** (no "email enviado"); aviso **ámbar** con scroll-to-top; invalidación
  del query de comunicaciones tras la mutación de fecha.
- **MODIFIED** "Plantillas dinámicas de la transición de fecha (disponible / cola)": el
  **asunto** de la rama "disponible" pasa a **"Pre-reserva confirmada"** (ES) / equivalente
  en catalán; la rama "cola" no cambia.

### Capability `comunicaciones`
- **MODIFIED** "Confirmación de envío de un borrador con edición opcional de asunto y
  cuerpo": el `cuerpo` (texto plano con saltos de línea) se **convierte a HTML** en el
  **borde de envío** (`html`=convertido con `<p>`/`<br>` + escape; `text`=crudo),
  preservando el formato en el cliente de correo.

### Sin cambios de contrato
- **Contrato OpenAPI / SDK: SIN cambios.** El flag `tieneBorradorE1Pendiente`
  (`ReservaPipelineItemDto`), `PATCH /reservas/{id}`, los endpoints de fecha y de
  comunicaciones (`GET /reservas/:id/comunicaciones`, envío de borrador) ya existen. Ver
  `design.md`.

## Trazabilidad

| Fuente | Uso en este change |
|--------|--------------------|
| US-005 (§Email relacionado) | Asunto E1 rama disponible → "Pre-reserva confirmada"; aviso de resultado |
| US-047 / change `email-transicion-fecha-borrador` | Borrador E1 manual; visibilidad y desbloqueo por envío |
| US-051 (§Punto 2, §Punto 4) | Edición de campos vía PATCH; reestructuración de acciones de la ficha |
| US-046 / UC-36 | Flujo de revisión/envío de borradores (E1) |
| US-045 (§Confirmación de envío, §Catálogo) | Borde de envío del motor; conversión texto→HTML |
| UC-04, UC-05, UC-12, UC-14, UC-18 | Alta con fecha, cambio atómico de fecha, presupuesto |
| er-diagram §3.17 COMUNICACION | `codigo_email`, `estado`, contenido del borrador |
| CLAUDE.md §Regla crítica: bloqueo atómico de fecha | La fecha NO se muta por PATCH |

## Impacto

- **Backend**: `plantilla-transicion-fecha.ts` (asunto), `actualizar-reserva.use-case.ts`
  (regeneración del borrador), borde de envío de email (helper `textoPlanoAHtml()` +
  `resend.email.adapter.ts`). Ver `design.md` para la decisión del helper y el riesgo de
  doble-escape del catálogo.
- **Frontend**: `AccionesConsulta.tsx`, `AccionEditarConsulta.tsx`, `AccionPresupuesto.tsx`,
  `AvisosTransicion.tsx`, invalidación del query de comunicaciones tras mutar la fecha,
  scroll-to-top.
- **Sin migración de BD** más allá de lo decidido para el catálogo en `design.md §B2`.
- **Contrato/SDK**: sin cambios.
