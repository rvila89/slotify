# ficha-consulta-ui Specification

## Purpose
TBD - created by archiving change 2026-07-20-descarte-aviso-inline-ficha. Update Purpose after archive.
## Requirements
### Requirement: Confirmación de descarte en la ficha — aviso inline verde en cabecera y desplazamiento al inicio

El sistema SHALL (DEBE), cuando el Gestor confirma desde la **Ficha de consulta**
(`FichaConsultaPage`) el descarte de una **pre-reserva** (US-011,
`pre_reserva → reserva_cancelada`) o de una **consulta** (US-013,
`2a/2b/2c/2d/2v → 2z`) y el backend responde con éxito (200), realizar dos acciones de
retroalimentación en la interfaz: (a) **mostrar un aviso inline de éxito** en la
cabecera de la ficha (banner verde esmeralda con ícono, título en negrita y
descripción, cerrable — mismo patrón visual que los demás avisos de desenlace de la
ficha, p. ej. `AvisoVisitaProgramada`) que informe de que la pre-reserva/consulta se
marcó como descartada correctamente, **incluyendo el código** de la reserva; y (b)
**desplazar la vista al inicio** de la página (`window.scrollTo({ top: 0, behavior:
'smooth' })`, patrón vivo del proyecto), de modo que el foco visual vuelva a la
cabecera donde el estado ya refleja el resultado.

El sistema NO DEBE mostrar la confirmación de éxito como un toast lateral (Sonner
`bottom-right`); la confirmación de estos descartes es el aviso inline. El host global
`<Toaster/>` permanece montado para otros dominios, pero los diálogos de descarte de
pre-reserva y de consulta NO DEBEN emitir `toast.success`.

El aviso y el desplazamiento SHALL (DEBEN) producirse **únicamente** ante respuesta de
éxito. Ante un error del backend (409 `transicion_no_permitida`, 422 `origen_invalido`
o error genérico) el sistema NO DEBE mostrar aviso de éxito ni desplazar la vista: el
error se presenta inline en el diálogo, que permanece abierto, y la vista conserva su
posición de scroll.

Esta conducta es de presentación (frontend) y NO altera las transiciones de dominio ni
sus efectos (liberación de fecha, promoción/reordenación de cola), que gobiernan las
capabilities de dominio (US-011, US-013).

Además, la Ficha de consulta SHALL (DEBE) mostrar **como máximo un aviso de desenlace a
la vez**: cuando se produce un nuevo desenlace (cualquier transición, envío o descarte que
genere aviso), este **sustituye** al aviso anterior en lugar de acumularse. De este modo el
Gestor ve únicamente el aviso de la **última** acción realizada, evitando la confusión de
varios banners simultáneos de acciones ya pasadas. El aviso visible se oculta al cerrarlo o
al iniciar una nueva acción.

(Fuente: petición de usuario; `AvisoVisitaProgramada.tsx` `border-emerald-200
bg-emerald-50 text-emerald-900`; `NuevaConsulta/NuevaConsultaPage.tsx`
`window.scrollTo`; `US-011`; `US-013 §Happy Path`.)

#### Scenario: Descarte de pre-reserva con éxito muestra aviso verde inline y sube al inicio

- **GIVEN** el Gestor autenticado en la Ficha de consulta de una RESERVA en estado
  `pre_reserva`, con la página desplazada hacia abajo (viendo la sección de acciones)
- **WHEN** confirma el descarte en el diálogo "Descartar pre-reserva" y el backend
  responde 200
- **THEN** aparece en la cabecera de la ficha un **aviso inline verde** (esmeralda)
  indicando que la pre-reserva se descartó correctamente, con su código
- **AND** la vista se desplaza al inicio de la página (posición de scroll superior)
- **AND** NO se muestra ningún toast lateral de éxito
- **AND** el diálogo se cierra y la ficha refleja el nuevo estado terminal
- **AND** el aviso es cerrable por el usuario

#### Scenario: Descarte de consulta con éxito muestra aviso verde inline y sube al inicio

- **GIVEN** el Gestor autenticado en la Ficha de consulta de una RESERVA en un
  sub-estado de consulta no terminal (p. ej. `2b`), con la página desplazada hacia
  abajo
- **WHEN** confirma el descarte en el diálogo "Marcar como descartada por cliente" y
  el backend responde 200
- **THEN** aparece en la cabecera de la ficha un **aviso inline verde** (esmeralda)
  indicando que la consulta se marcó como descartada por el cliente, con su código
- **AND** la vista se desplaza al inicio de la página (posición de scroll superior)
- **AND** NO se muestra ningún toast lateral de éxito
- **AND** el diálogo se cierra y la ficha refleja el nuevo estado terminal
- **AND** el aviso es cerrable por el usuario

#### Scenario: Descarte que falla no muestra aviso de éxito ni desplaza

- **GIVEN** el Gestor en la Ficha de consulta (pre-reserva o consulta) con la página
  desplazada hacia abajo
- **WHEN** confirma el descarte pero el backend responde con error (409
  `transicion_no_permitida`, 422 `origen_invalido` o genérico)
- **THEN** NO se muestra el aviso inline verde de éxito
- **AND** la vista NO se desplaza al inicio (conserva su posición de scroll)
- **AND** el mensaje de error se presenta inline en el diálogo, que permanece abierto

#### Scenario: Un nuevo desenlace sustituye al aviso anterior (solo el último visible)

- **GIVEN** el Gestor en la Ficha de consulta con un aviso de desenlace ya visible en la
  cabecera (p. ej. el de una transición previa) que no ha cerrado
- **WHEN** realiza una nueva acción con éxito que genera su propio aviso (p. ej. un
  descarte)
- **THEN** se muestra **únicamente** el aviso de la última acción
- **AND** el aviso anterior deja de mostrarse (no se acumulan varios banners a la vez)

### Requirement: Registrar firma de condicions particulars muestra banner inline, no toast

La UI SHALL (DEBE) mostrar un banner verde inline al registrar con éxito la firma de
condicions particulars (primera vez o re-subida), haciendo scroll al inicio de la página
en lugar del toast Sonner actual. El patrón MUST (DEBE) ser idéntico al del resto de
acciones de desenlace de la ficha: color `border-emerald-200 bg-emerald-50`, icono
`CheckCircle2`, mensaje descriptivo, botón de cierre, gestionado por `useAvisosFicha`.

El sistema SHALL (DEBE) implementar:
- `AvisoCondicionesFirmadas` (nuevo componente): acepta `tipo: 'registrada' | 'reregistrada'`
  y `onCerrar`. Mensajes diferenciados por tipo.
- `useAvisosFicha`: añade `firma: 'registrada' | 'reregistrada' | null` + `mostrarFirma(tipo)`.
- `AvisosFicha`: renderiza `AvisoCondicionesFirmadas` cuando `firma !== null`.
- `CondicionesFirmadasCard`: acepta `onRegistrado?: (tipo) => void`; invoca la prop
  en lugar de `notify.success()` cuando está disponible.
- `FichaConsultaPage`: callback `onRegistrado` → `avisos.mostrarFirma(tipo)` + scroll top.

#### Scenario: Registrar firma por primera vez muestra banner de registro

- **GIVEN** una RESERVA en `reserva_confirmada` con `condPartFirmadas = false`
- **WHEN** el gestor adjunta el documento firmado y confirma en el diálogo
- **THEN** el diálogo se cierra
- **AND** la página hace scroll al inicio
- **AND** aparece un banner verde inline con mensaje de primera firma registrada
- **AND** NO aparece ningún toast Sonner

#### Scenario: Re-subir una versión firmada muestra banner diferenciado

- **GIVEN** una RESERVA con `condPartFirmadas = true`
- **WHEN** el gestor sube una versión más legible del documento firmado
- **THEN** el banner inline muestra el mensaje de nueva versión registrada
- **AND** el mensaje es distinto al de la primera firma

#### Scenario: FichaConsultaPage conecta CondicionesFirmadasCard con el sistema de avisos

- **GIVEN** la `FichaConsultaPage` renderizando `SeccionesFicha` con `CondicionesFirmadasCard`
- **WHEN** `CondicionesFirmadasCard` llama al callback `onRegistrado`
- **THEN** `useAvisosFicha.mostrarFirma(tipo)` se invoca
- **AND** `window.scrollTo({ top: 0, behavior: 'smooth' })` se ejecuta

---

### Requirement: Mensaje de condicions no enviadas referencia E2

El aviso de "condicions no enviadas" en `CondicionesFirmadasCard` SHALL (DEBE) referenciar
el email E2 (presupuesto), no E3. El texto "(E3)" MUST (DEBE) sustituirse por "(E2)".

#### Scenario: Aviso de condicions no enviadas referencia E2

- **GIVEN** una RESERVA donde `condPartFechaEnvio` es null
- **WHEN** el gestor visualiza la tarjeta de firma de condicions
- **THEN** el aviso indica que las condicions se envían con el presupuesto "(E2)"
- **AND** no hay ninguna referencia a "(E3)" en ese aviso

### Requirement: Botón "Solicitar datos" en el modal de presupuesto — visible solo con datos fiscales incompletos, deja el email en borrador con banner y refresco de Comunicaciones

El sistema SHALL (DEBE) mostrar, en el modal **"Generar presupuesto"**
(`GenerarPresupuestoDialog`), un **botón secundario "Solicitar datos"** que aparece
**ÚNICAMENTE cuando los datos fiscales del cliente están incompletos**. La condición de
visibilidad SHALL (DEBE) reutilizar la validación existente `DATOS_FISCALES_INCOMPLETOS`
sobre `dniNif`, `direccion`, `codigoPostal`, `poblacion` y `provincia`
(`camposFiscalesFaltantes` / `CAMPOS_FISCALES`, `datosFiscalesCampos.ts`): si `dniNif`,
`direccion`, `codigoPostal`, `poblacion` y `provincia` están **completos**, el botón **NO se
muestra**.

Al pulsar el botón, el sistema SHALL (DEBE) invocar la acción de solicitud de datos
(endpoint `POST /reservas/{id}/comunicaciones/solicitar-datos-presupuesto`, capability
`comunicaciones`, vía el hook `useSolicitarDatosPresupuesto`) y, ante **éxito** (borrador
creado o borrador pendiente reutilizado): (a) **cerrar el modal**; (b) **desplazar la vista
al inicio** de la ficha (`window.scrollTo({ top: 0 })`, patrón vivo del proyecto); (c)
mostrar un **banner de confirmación** arriba de la ficha (banner emerald cerrable, mismo
patrón visual que `AvisoFacturaSenalEnviada`, gestionado por `useAvisosFicha` con
`mostrarSolicitudDatosBorrador`, respetando el invariante "un solo aviso visible a la vez");
y (d) **refrescar el listado de Comunicaciones** de la RESERVA (invalidar la query de
comunicaciones) para que el **borrador aparezca** en la sección Comunicaciones. La prop de
callback (`onSolicitarDatos`) SHALL (DEBE) cablearse desde el diálogo hasta
`FichaConsultaPage`, siguiendo el patrón vivo de `onConfirmadoPresupuesto`.

Ante **error de la acción** (p. ej. `409` porque ya se envió una solicitud, `422` porque los
datos ya están completos, o error genérico), el sistema NO DEBE cerrar el modal por éxito ni
mostrar el banner de confirmación: el error se presenta al gestor y la ficha conserva su
estado. El **envío** posterior del borrador (revisar y enviar) mantiene el comportamiento
existente —scroll al inicio + banner "email enviado" + lista de comunicaciones actualizada—
gobernado por `ComunicacionesCard.onEmailEnviado → useAvisosFicha.mostrarEmailEnviado`, que
este change NO modifica. Esta conducta es de **presentación (frontend)**; el efecto de
servidor (creación/reutilización del borrador, idempotencia) lo define la capability
`comunicaciones`. La UI SHALL (DEBE) cumplir las reglas duras del proyecto: arrow functions;
`components/` solo `.tsx` (helpers/tipos en `lib/`/`model/`); **mobile-first** verificado en
390 / 768 / 1280 sin overflow horizontal. (Fuente: petición de producto; `datosFiscalesCampos.ts`;
`GenerarPresupuestoDialog.tsx`; `FichaConsultaPage.tsx` `onConfirmadoPresupuesto`;
`useAvisosFicha.ts` `mostrarFacturaSenalEnviada`; `AvisoFacturaSenalEnviada.tsx`.)

#### Scenario: Con datos fiscales incompletos el botón aparece y deja el email en borrador

- **GIVEN** el Gestor autenticado en la Ficha de consulta de una RESERVA cuyo cliente tiene
  datos fiscales **incompletos**, con el modal "Generar presupuesto" abierto
- **WHEN** observa el modal
- **THEN** ve el botón secundario "Solicitar datos"
- **WHEN** pulsa "Solicitar datos" y la acción responde con éxito
- **THEN** el modal se cierra
- **AND** la vista se desplaza al inicio de la ficha
- **AND** aparece arriba un banner de confirmación (emerald, patrón `AvisoFacturaSenalEnviada`)
- **AND** el nuevo **borrador** aparece en la sección Comunicaciones (lista refrescada)

#### Scenario: Con datos fiscales completos el botón no se muestra

- **GIVEN** el Gestor en la Ficha de consulta de una RESERVA cuyo cliente tiene **completos**
  `dniNif`, `direccion`, `codigoPostal`, `poblacion` y `provincia`, con el modal "Generar
  presupuesto" abierto
- **WHEN** observa el modal
- **THEN** el botón "Solicitar datos" NO aparece

#### Scenario: Una solicitud ya enviada devuelve 409 y no muestra el banner de éxito

- **GIVEN** el Gestor en el modal de presupuesto de una RESERVA para la que ya se **envió** una
  solicitud de datos (terna `('E1', 'solicitud_datos')` en `enviado`) y el botón aún está
  visible por seguir faltando datos
- **WHEN** pulsa "Solicitar datos" y la acción responde `409`
- **THEN** el sistema NO cierra el modal por éxito ni muestra el banner de confirmación
- **AND** informa al gestor de que la solicitud ya se envió (no se puede reenviar)

#### Scenario: Enviar el borrador de solicitud reutiliza el flujo existente de "email enviado"

- **GIVEN** una RESERVA con un borrador de solicitud de datos visible en la sección
  Comunicaciones
- **WHEN** el gestor revisa y envía ese borrador con éxito
- **THEN** el sistema aplica el comportamiento existente: scroll al inicio + banner "email
  enviado" + lista de comunicaciones actualizada (vía `onEmailEnviado → mostrarEmailEnviado`)
- **AND** este change no altera ese flujo

