# Spec Delta — Capability `ficha-consulta-ui`

> **solicitud-datos-presupuesto-borrador** — Añade un botón **"Solicitar datos"** en el modal
> "Generar presupuesto" (`GenerarPresupuestoDialog`) que aparece **solo** cuando los datos
> fiscales del cliente están incompletos. Al pulsarlo, el sistema deja en borrador el email de
> solicitud (endpoint de la capability `comunicaciones`), **cierra el modal**, hace **scroll al
> inicio**, muestra un **banner de confirmación** (emerald, patrón `AvisoFacturaSenalEnviada`) y
> **refresca la sección Comunicaciones**. El flujo de **enviar** ese borrador (banner "email
> enviado" + refresco) YA EXISTE (`ComunicacionesCard.onEmailEnviado →
> useAvisosFicha.mostrarEmailEnviado`) y NO se toca.
>
> Fuente: petición de producto (botón visible solo con datos incompletos; cerrar modal +
> scroll + banner + refresco); `apps/web/src/features/presupuestos/lib/datosFiscalesCampos.ts`
> (`CAMPOS_FISCALES`, `camposFiscalesFaltantes`);
> `apps/web/src/features/presupuestos/components/GenerarPresupuestoDialog.tsx`;
> `apps/web/src/features/reservas/pages/FichaConsulta/FichaConsultaPage.tsx` (patrón
> `onConfirmadoPresupuesto`); `useAvisosFicha.ts` (`mostrarFacturaSenalEnviada`);
> `AvisoFacturaSenalEnviada.tsx`; spec viva `ficha-consulta-ui` "Registrar firma … muestra
> banner inline, no toast".

## ADDED Requirements

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
