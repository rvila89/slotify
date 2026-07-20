# Design — consulta-fecha-borrador-fix

Decisiones técnicas no triviales del fix del flujo "consulta sin fecha". El resto
(renombrar el asunto E1, ocultar el botón duplicado, aviso ámbar + scroll) es
implementación directa sin decisiones de diseño y no se documenta aquí.

---

## D-1. Contrato OpenAPI / SDK: SIN cambios (explícito)

Este change **no toca el contrato**. Se confirma que todo lo que necesita ya existe:

- **`ReservaPipelineItemDto.tieneBorradorE1Pendiente`** (boolean) ya lo devuelve
  `GET /reservas` y ya lo consume el frontend (spec viva `consultas` "El ítem del
  pipeline expone si la reserva tiene un borrador E1 pendiente").
- **`PATCH /reservas/{id}`** (`UpdateReservaRequest`) ya edita los campos simples y NO
  muta la fecha (spec viva "Edición de los datos de una consulta/reserva").
- **`GET /reservas/:id/comunicaciones`** + envío/edición de borrador ya existen (US-046).
- Flujos atómicos de fecha (`POST /reservas/{id}/fecha`, cambio de fecha) ya existen.

**Acción de contrato en `tasks.md`**: `contract-engineer` **confirma** que no hay
cambios (auditoría de no-diff), sin editar `docs/api-spec.yml`. No se regenera el SDK.

---

## D-2. B2 — Formato del email: helper `textoPlanoAHtml()` en el borde de envío

### Problema
`ResendEmailAdapter.enviar` (`resend.email.adapter.ts:45-52`) envía:

```ts
html: comando.cuerpo,
text: comando.cuerpo,
```

El `cuerpo` de la plantilla de transición (`plantilla-transicion-fecha.ts`) es **texto
plano con `\n`**. Enviado como `html`, el cliente de correo **colapsa** los saltos de
línea (HTML ignora `\n`). El catálogo (`catalogo-plantillas.ts:80-83`) ya resuelve esto,
pero **dentro** de cada render, guardando **HTML** en el `cuerpo`:

```ts
const cuerpoHtml = cuerpoTexto
  .split('\n\n')
  .map(p => `<p>${htmlEscape(p).replace(/\n/g, '<br>')}</p>`)
  .join('');
```

### Decisión
1. **Extraer** la conversión a un **helper compartido y puro** `textoPlanoAHtml(texto:
   string): string` (escape HTML + `\n\n → <p>…</p>` + `\n → <br>`), en un módulo sin
   dependencias de framework/infra (aplicación de `comunicaciones`, reutilizable por el
   catálogo y por el borde de envío). Se reutiliza el `htmlEscape` existente.
2. **Aplicarlo en el BORDE DE ENVÍO**: el adaptador (o el servicio de envío justo antes de
   invocar el puerto) envía `html = textoPlanoAHtml(cuerpo)` y `text = cuerpo` (crudo).

### Riesgo: doble-escape del catálogo (el catálogo ya guarda HTML)
Si se aplica `textoPlanoAHtml()` **ciegamente** a un `cuerpo` que ya es HTML (los E1/E2/E3
del catálogo), se **doble-escapa** (`<p>` → `&lt;p&gt;`) y se rompen esos correos. Dos
opciones — **se elige (ii)** para minimizar la superficie de cambio y el riesgo de
regresión en emails ya en producción:

- **(i) Estandarizar el almacenamiento a texto plano** y migrar el catálogo a guardar
  texto plano, convirtiendo SIEMPRE en el borde de envío. Más limpio conceptualmente pero
  **toca E1/E2/E3 en producción** y exige migrar/re-renderizar. **Descartada** por riesgo.
- **(ii) Aislar la conversión** al **E1 de transición** (`plantilla-transicion-fecha.ts`,
  cuyo `cuerpo` es texto plano) y a los **emails manuales** (el `RevisarEnviarBorradorDialog`
  del frontend ya edita/guarda el `cuerpo` como **texto plano** en un `<textarea>`). El
  catálogo **sigue** guardando HTML y **no** se le vuelve a aplicar la conversión.
  **ELEGIDA.**

### Cómo se distingue "texto plano" de "HTML ya renderizado" en el borde de envío
Regla determinista y conservadora: se convierte con `textoPlanoAHtml()` **solo** cuando el
`cuerpo` **no contiene marcado de bloque HTML** (heurística: ausencia de `<p>`/`<br` /
`<div`/`<ul`, etc.). Un cuerpo que ya trae `<p>`/`<br>` (catálogo E1/E2/E3) se envía tal
cual. Alternativa preferida si resulta frágil: pasar un **flag explícito**
`cuerpoEsHtml: boolean` (o `formatoCuerpo: 'html' | 'texto'`) en `EnviarEmailComando` para
que el llamador declare el formato — decisión final durante TDD según lo que resulte más
robusto en los tests de no-regresión. En ambos casos, **el catálogo NO se doble-escapa**.

### Tests de no-regresión OBLIGATORIOS
- **E1/E2/E3 del catálogo**: su HTML llega **intacto** al puerto (sin doble-escape) — se
  asertan sobre el `EnviarEmailComando`/`attachments` con el fake transport.
- **E1 de transición (texto plano)**: el `html` enviado contiene `<p>`/`<br>` y los saltos
  de párrafo/línea se preservan; el `text` conserva el `\n` crudo.
- **Email manual (texto plano del textarea)**: idéntico al E1 de transición.

---

## D-3. B3 — Regenerar el borrador E1 al editar la consulta

### Problema
El gestor edita personas/horario/duración desde "Editar consulta" (`PATCH /reservas/{id}`),
pero el borrador E1 ya creado conserva los **placeholders `___`** (spec viva `consultas`
"Placeholder visible cuando faltan personas u horas"). El borrador no se ve reflejado.

### Decisión
En `actualizar-reserva.use-case.ts`, **tras** actualizar los campos simples (post-commit
del UPDATE + AUDIT_LOG), **si existe** una `COMUNICACION` con `codigo_email = 'E1'` y
`estado = 'borrador'` para la RESERVA:

1. Re-renderizar con `renderMensajeTransicionFecha` (módulo puro ya existente):
   - `tipo`: según el `subEstado` de la RESERVA — `2b → 'disponible'`, `2d → 'cola'`.
   - `idioma`: `reserva.idioma` (`'ca'` → catalán; resto → castellano).
   - `nombre`, `fechaEvento`, `personas` (= `numInvitadosFinal`), `horas`
     (= `duracionHoras`) con los **valores ya actualizados**.
2. Actualizar el borrador vía
   `DespacharEmailService.actualizarContenidoBorrador({ tenantId, idComunicacion, asunto,
   cuerpo })` (ya existe: `despachar-email.service.ts:438-445`; mantiene la fila en
   `borrador`, guarda de estado en el repo).

### Reglas y matices (documentados, no reabrir)
- **NO se añade guarda 409**: editar la consulta con borrador E1 pendiente **SÍ está
  permitido** (es precisamente el flujo que resuelve el placeholder). El PATCH conserva su
  semántica: no muta `fechaEvento`/`estado`/`subEstado` (regla dura §D-1 del use-case).
- **La regeneración SOBRESCRIBE ediciones manuales previas del borrador**. Es **aceptable**:
  el correo **aún no se ha enviado** y el objetivo es que refleje los datos vigentes. Se
  documenta explícitamente y se cubre con un escenario de spec.
- **Best-effort post-commit**: la regeneración ocurre **fuera** de la unidad de trabajo del
  PATCH (igual patrón que el pre-relleno del borrador en el alta,
  `fix-borrador-e1-cuerpo-prerelleno`). Si la regeneración falla, el PATCH responde `200`
  igualmente y el borrador queda editable; se registra el fallo, no se revierte la edición.
- **Solo E1 en `borrador`**: si el E1 ya está `enviado`/`fallido`, NO se regenera (no
  existe borrador que tocar).
- **Hexagonal**: el use-case orquesta puertos ya inyectados; el render es un módulo puro de
  aplicación (no importa framework/infra, hook `no-infra-in-domain`).

---

## D-4. Frontend — visibilidad del borrador y desbloqueo parcial

Sin decisiones de arquitectura nuevas; se listan para el implementador y el reviewer:

- **Invalidación del query de comunicaciones** tras cualquier mutación de fecha (asignar
  `2a→2b/2d`, cambio atómico) **y** tras el PATCH de edición: el frontend invalida tanto el
  query de la reserva como el de `comunicaciones` (`queryClient.invalidateQueries`), para
  que el borrador y su nuevo contenido aparezcan sin recargar.
- **Desbloqueo PARCIAL de acciones** (sustituye el bloqueo total): con
  `tieneBorradorE1Pendiente === true` se **permiten** "Editar consulta" y la gestión de
  fecha; el resto de acciones downstream (presupuesto, visita, descartar…) quedan
  **bloqueadas** con el CTA "Revisa y envía el correo de confirmación" junto a "Generar
  presupuesto". La guarda es de **UI**; las guardas de servidor (US-046, máquina de
  estados) permanecen intactas.
- **Aviso ámbar + scroll-to-top**: `AvisosTransicion.tsx` deja de mostrar el aviso verde
  "email enviado" y muestra un aviso **ámbar** "borrador de confirmación pendiente de
  revisión y envío"; tras asignar/cambiar fecha se hace scroll al aviso.
- **Un solo "Editar consulta"**: se elimina la duplicación (`AccionPresupuesto` deja de
  renderizar su propio "Editar consulta"); el modal de edición ya no contiene la sección
  de fecha (la fecha se gestiona por su flujo atómico).
- **Responsive (regla dura CLAUDE.md)**: verificar los 3 viewports (390 / 768 / 1280) en
  el E2E.

---

## Alternativas descartadas

- **Autoenviar el E1** al asignar fecha: descartada — el usuario decidió mantener el correo
  **manual con revisión** (US-047). El fix es de visibilidad + desbloqueo, no de automatismo.
- **Migrar el catálogo a texto plano** (D-2 opción i): descartada por riesgo de regresión
  en E1/E2/E3 productivos.
- **Guarda 409 al editar con borrador pendiente**: descartada — editar es el flujo deseado.
