# Design — us-047-borrador-e1-comportamiento

> Decisiones técnicas del change. Todas las abiertas requieren visto bueno humano en el
> **Gate de revisión SDD** antes de contrato/TDD/implementación. Ámbito reducido: refina
> comportamiento sobre US-045/US-046 (archivadas), sin nueva migración de esquema propia.

## Contexto

US-046 dejó `EnviarBorradorUseCase` (envío manual de un borrador desde la ficha) y la
superficie HTTP de comunicaciones de la RESERVA. US-045 dejó el motor de email, el catálogo
de plantillas E1 por idioma y el **adjunto del dossier por referencia de URL**, que hoy solo
`AltaConsultaUseCase` usa. US-047 cierra cinco brechas de comportamiento reutilizando esa
infraestructura. La única dependencia de datos es el campo `RESERVA.idioma` de la migración
`20260717150000_add_idioma_horario_to_reserva` (en curso).

## Decisiones

### D-1: `tieneBorradorE1Pendiente` se calcula en el pipeline DTO y la ficha lo comparte

`ReservaPipelineItemDto` (respuesta de `GET /reservas`) gana el campo booleano
`tieneBorradorE1Pendiente`. El flag se calcula en el **mismo query del pipeline** (existencia
de `COMUNICACION(codigo_email = 'E1', estado = 'borrador')` para la RESERVA), bajo el
contexto RLS del tenant, para no incurrir en N+1 ni en un endpoint adicional. La **ficha de
la consulta** obtiene el mismo dato del mismo query/DTO del pipeline, evitando una fuente de
verdad divergente entre dashboard y ficha.

- **Alternativa descartada**: endpoint dedicado o llamada por-reserva a
  `GET /reservas/{id}/comunicaciones` para decidir el bloqueo. Rechazada por coste (N+1 en
  el kanban) y por duplicar el criterio de "hay E1 en borrador" en dos sitios.
- **Requiere OK humano**: forma exacta del cálculo (subconsulta `EXISTS` vs. `LEFT JOIN`
  agregado) y su ubicación en el adapter de listado de reservas.

### D-2: `EnviarBorradorUseCase` obtiene `idioma` de la reserva que ya carga

El use-case **ya carga la RESERVA** para validar el envío del borrador (tenant, cliente,
estado). De esa misma reserva obtiene `reserva.idioma` para elegir el dossier
(`Dossier-Masia-Encis-{idioma}.pdf`), sin consultas adicionales. Si `idioma` está ausente,
degrada a `'es'` por defecto, igual que `AltaConsultaUseCase`. El adjunto solo se añade
cuando `codigoEmail === 'E1'`; para otros códigos no se adjunta.

- **Reutiliza** el helper/puerto de adjunto por referencia de US-045 (mismo mecanismo que
  el alta). No se reimplementa la construcción del adjunto ni la descarga del PDF.
- **Degradación graceful**: si `dossierBaseUrl` no está configurado, se envía sin adjunto
  (paridad exacta con el comportamiento del alta), sin bloquear el envío.
- **Requiere OK humano**: confirmar que se reutiliza el mismo mecanismo/puerto de adjunto
  del alta y no una copia local.

### D-3: El cuerpo mostrado en el modal es el ya almacenado; no se re-renderiza la plantilla

El `cuerpo` del borrador se generó al crear la `COMUNICACION` en el alta (US-045, plantilla
E1 renderizada según idioma y situación de fecha). El `RevisarEnviarBorradorDialog` muestra
y edita ese `cuerpo` **tal cual está persistido**; no vuelve a renderizar la plantilla en el
modal. El cambio a `max-w-2xl` es puramente de layout y no toca el contenido. Esto preserva
la invariante de US-046 "el `asunto`/`cuerpo` persistido refleja lo efectivamente enviado".

### D-4: El bloqueo cubre TODA `AccionesConsulta`, incluida "Marcar como descartada"

El aviso y el ocultado del bloque `AccionesConsulta` aplican a **todas** sus acciones,
incluida "Marcar como descartada". Racional de negocio: sin el primer email enviado al
cliente, ninguna transición del ciclo de vida (avanzar sub-estado, programar visita,
descartar) tiene sentido; se fuerza a revisar y enviar el E1 primero. El bloqueo es una
guarda de UI derivada del flag `tieneBorradorE1Pendiente`; **no** sustituye ni relaja las
guardas de servidor de la máquina de estados (que siguen validando cada transición).

- **Requiere OK humano**: confirmar que "Marcar como descartada" queda incluido en el
  bloqueo (y no exento como vía de escape).

### D-5: El flag se recalcula en cada fetch; no hay persistencia dedicada

`tieneBorradorE1Pendiente` **no** se persiste en `RESERVA` ni en ninguna columna nueva: se
deriva en cada lectura del pipeline de la existencia de un borrador E1. Cuando el gestor
envía el borrador (`enviado`) o lo descarta por vía backend (`fallido`), en el **siguiente
fetch** el flag vale `false` automáticamente, sin evento, cron ni columna dedicada. Esto
mantiene el change libre de migración de esquema propia y evita estado derivado que pueda
quedar desincronizado.

- **Alternativa descartada**: columna materializada `tiene_borrador_e1_pendiente` mantenida
  por triggers/transiciones. Rechazada por complejidad y riesgo de desincronización frente
  a un cálculo barato en el query.

## Riesgos y mitigaciones

- **Coste del flag en el kanban**: subconsulta de existencia por ítem. Mitigación: `EXISTS`
  correlacionado o join agregado con índice sobre `COMUNICACION(reserva_id, codigo_email,
  estado)`; se mide en QA (step-11) con datos reales (memoria: "US-049 backend nunca probado
  contra BD real" — exigir integración SQL real).
- **`RESERVA.idioma` ausente si la migración no está aplicada**: el use-case degrada a
  `'es'`; QA verifica con la migración `20260717150000` aplicada.
- **Regresión en el descarte backend**: la MODIFIED conserva la lógica/guardas/auditoría de
  US-046 intactas; solo se retira la exposición en UI. QA verifica que el endpoint sigue
  operativo por curl.
- **Responsive del modal ancho** (regla dura): `max-w-2xl` debe no romper en 390/768/1280;
  se verifica en E2E (step-13) en los tres viewports.

## Decisiones cerradas (sin ambigüedad)

- El botón "Descartar" se **retira de la UI** y `DescartarBorradorDialog` se **elimina**; el
  endpoint backend y su spec (US-046, ahora MODIFIED) se **conservan**.
- El texto del aviso de bloqueo es "Revisa y envía el correo de confirmación antes de
  continuar."; el texto del badge es "Borrador E1 pendiente" (ámbar).
- El adjunto del borrador E1 usa el nombre y el mecanismo de US-045
  (`Dossier-Masia-Encis-{idioma}.pdf`, por referencia de URL).
