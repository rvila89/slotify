# Change: solicitud-datos-presupuesto-borrador

## Why

Para **generar un presupuesto** el sistema necesita los **datos fiscales del cliente**
(nombre y apellidos, DNI/NIF, dirección y población). Hoy esos datos se piden al cliente
únicamente a través del **borrador E1 "disponible"** (`subtipo = fecha_disponible`), que se
genera **solo** cuando ocurre la transición de fecha en la **rama libre** `2a → 2b`
(consulta exploratoria a la que después se le añade una fecha disponible). El texto de ese
E1 incluye literalmente la solicitud de datos: *"Para poder prepararte el presupuesto,
necesitaría los siguientes datos: Nombre y apellidos / DNI / Dirección y población"*.

**El hueco**: si el cliente aporta la fecha **ya en la primera consulta** y el gestor la
anota directamente (sin pasar por la transición `2a → 2b`), **nunca se genera ese
borrador**. Al ir a **generar el presupuesto**, faltan los datos fiscales del cliente y **no
existe ningún email que se los haya solicitado**. El gestor queda sin una acción para pedir
esos datos por el canal habitual (borrador que revisa y envía).

**Resultado buscado**: un **botón "Solicitar datos"** en el modal **"Generar presupuesto"**
que, **cuando los datos fiscales del cliente estén incompletos**, deje **EN BORRADOR** un
email (en castellano o catalán según el idioma de comunicación de la reserva) solicitándolos.
El gestor lo revisa y lo envía, igual que cualquier borrador manual. El texto del email es el
**mismo** que ya usa el E1 disponible (se reutiliza, no se reescribe).

- **Al pulsar el botón**: se cierra el modal, la página hace **scroll al inicio**, aparece un
  **banner de confirmación** arriba de la ficha (alineado con el resto de avisos de la app) y
  el **borrador aparece en la sección Comunicaciones**.
- **Al enviarlo** (revisar y enviar el borrador): scroll al inicio + banner de "email
  enviado" + lista de comunicaciones actualizada. **Este flujo YA EXISTE** vía
  `ComunicacionesCard.onEmailEnviado → useAvisosFicha.mostrarEmailEnviado`; no se toca.

### Decisiones de producto confirmadas (requisitos)

1. **Visibilidad condicionada**: el botón "Solicitar datos" es **visible SOLO SI** faltan
   datos fiscales del cliente. Reutiliza la validación existente `DATOS_FISCALES_INCOMPLETOS`
   sobre `dniNif / direccion / codigoPostal / poblacion / provincia`
   (`camposFiscalesFaltantes`, `CAMPOS_FISCALES`). Con datos fiscales **completos**, el botón
   **no aparece**.
2. **Una sola vez (idempotente)**: si **ya se envió** una solicitud de datos para esa reserva,
   **no se puede reenviar** → `409`. Si existe un **borrador sin enviar**, se **reutiliza** (no
   se duplica).

### Fuera de alcance (decisión de producto)

- **No se reescribe el texto del email**: se reutiliza `renderMensajeTransicionFecha({ tipo:
  'disponible', … })`, exactamente el mismo cuerpo que el E1 disponible. Cualquier retoque de
  copy queda fuera de este change.
- **No se modifica el flujo de enviar borrador ni el banner de "email enviado"**: ya existe y
  funciona (`onEmailEnviado → mostrarEmailEnviado`).
- **No se autocompletan datos fiscales** ni se añade edición inline en el modal: el objetivo
  es únicamente **solicitarlos** al cliente por email.
- **No cambia** la máquina de estados, el bloqueo atómico de fecha, ni el transporte de email.
- **No colisiona con el E1 de transición**: la solicitud usa un `subtipo` NUEVO
  (`solicitud_datos`) bajo `codigo_email = 'E1'`, distinto de `fecha_disponible` /
  `cola_espera`, de modo que ambas ternas conviven sin colisionar en el índice de idempotencia.

## What Changes

### Backend — nuevo caso de uso + endpoint (capability `comunicaciones`)
- Nuevo `SolicitarDatosPresupuestoUseCase` en `apps/api/src/comunicaciones/`.
- Nuevo endpoint `POST /reservas/{id}/comunicaciones/solicitar-datos-presupuesto`.
- **Reutiliza la plantilla existente** `renderMensajeTransicionFecha({ tipo: 'disponible',
  idioma, nombre, fechaEvento, personas, horas })`
  (`apps/api/src/reservas/application/plantilla-transicion-fecha.ts`): `idioma = 'ca'` →
  catalán; cualquier otro (`'es'`) → castellano. El idioma sale de `Reserva.idioma`.
- Crea la comunicación como **borrador** con el patrón estándar
  `DespacharEmailService.despachar({ autoenviar: false })` → `COMUNICACION` con
  `estado = 'borrador'`, `fecha_envio = null`, `codigo_email = 'E1'`,
  `subtipo = 'solicitud_datos'` (subtipo **nuevo**).
- **Idempotencia** (regla de producto 2): si ya existe una `COMUNICACION` de la terna
  `(reserva_id, 'E1', 'solicitud_datos')` en `estado = 'enviado'`, el endpoint responde `409`
  (`ComunicacionDuplicadaError`, respaldado por el índice UNIQUE parcial existente). Si existe
  un **borrador** sin enviar de esa terna, se **reutiliza** (no se crea otra fila).
- **Guarda de datos completos** (regla de producto 1, lado servidor): si los datos fiscales
  del cliente ya están completos, el endpoint responde `422` (defensa en profundidad; el
  botón ya no debería estar visible).
- **Multi-tenancy y auditoría**: opera bajo el `tenant_id` y `rol` del JWT (RLS + filtro
  `tenant_id`), sobre el cliente de la reserva; registra la acción en `AUDIT_LOG`.

### Contrato (lo ejecutará `contract-engineer` tras el gate)
- Añadir el path `POST /reservas/{id}/comunicaciones/solicitar-datos-presupuesto` a
  `docs/api-spec.yml` con sus respuestas (`201` borrador creado/reutilizado, `409` ya
  enviado, `422` datos completos, `404` reserva inexistente).
- Añadir `solicitud_datos` al enum de `subtipo` de comunicación en el contrato.
- **Regenerar el SDK** del frontend desde el contrato (nunca a mano; hook
  `protect-generated-client`).

### Frontend (capability `ficha-consulta-ui`)
- Nuevo hook `useSolicitarDatosPresupuesto` (mutación contra el endpoint, invalida la query de
  comunicaciones de la reserva).
- **Botón secundario "Solicitar datos"** en `GenerarPresupuestoDialog.tsx`, **visible solo si
  faltan datos fiscales** (reutiliza `camposFiscalesFaltantes` / `CAMPOS_FISCALES` de
  `apps/web/src/features/presupuestos/lib/datosFiscalesCampos.ts`).
- Nueva prop `onSolicitarDatos` cableada desde el diálogo hasta `FichaConsultaPage.tsx`,
  siguiendo el patrón vivo de `onConfirmadoPresupuesto`.
- `useAvisosFicha`: nuevo estado + `mostrarSolicitudDatosBorrador()` (respetando el invariante
  "un solo aviso visible", mismo patrón que `mostrarFacturaSenalEnviada`).
- `AvisosFicha` + nuevo componente `AvisoSolicitudDatosBorrador` (banner emerald, patrón de
  `AvisoFacturaSenalEnviada`).
- **Al crear el borrador**: cerrar el modal, `window.scrollTo({ top: 0 })`, mostrar el banner
  y refrescar la lista de Comunicaciones (invalidar la query de comunicaciones).
- **Reglas duras**: arrow functions; `components/` solo `.tsx` (helpers/tipos en
  `lib/`/`model/`); mobile-first verificado en 390 / 768 / 1280.

## Impact

- **Specs afectadas**:
  - `specs/comunicaciones/spec.md`:
    - **ADDED** "Solicitud de datos de presupuesto — borrador E1 (`subtipo =
      solicitud_datos`) reutilizando la plantilla del E1 disponible".
    - **MODIFIED** "Idempotencia de un email por reserva y código" — se añade
      `solicitud_datos` al enumerado de `subtipo` de E1 y se describe su terna idempotente.
  - `specs/ficha-consulta-ui/spec.md`:
    - **ADDED** "Botón 'Solicitar datos' en el modal de presupuesto visible solo con datos
      fiscales incompletos; al crear el borrador cierra el modal, hace scroll al inicio,
      muestra banner y refresca Comunicaciones".
- **Código afectado (tras el gate; no en este change)**:
  - Backend: `SolicitarDatosPresupuestoUseCase` + controlador del endpoint en
    `apps/api/src/comunicaciones/`; nuevo valor `solicitud_datos` en `enum SubtipoEmail`
    (`apps/api/prisma/schema.prisma`, migración aditiva de enum); reutiliza
    `renderMensajeTransicionFecha` y `DespacharEmailService`.
  - Contrato: nuevo path + subtipo `solicitud_datos`; SDK regenerado.
  - Frontend: `useSolicitarDatosPresupuesto`; botón en `GenerarPresupuestoDialog.tsx`; prop
    `onSolicitarDatos` hasta `FichaConsultaPage.tsx`; `useAvisosFicha`
    (`mostrarSolicitudDatosBorrador`); `AvisosFicha` + `AvisoSolicitudDatosBorrador`.
- **NO reimplementa**: el texto del email (reutiliza la plantilla E1 disponible), el motor de
  despacho de borradores, el flujo de enviar borrador + banner "email enviado", la máquina de
  estados, el bloqueo atómico de fecha, ni el transporte de email.
- **Riesgo principal**: bajo. El punto sensible es la **idempotencia** (que el 2.º envío tras
  un `enviado` dé `409` y que el borrador pendiente se reutilice en vez de duplicarse), que ya
  está respaldada por el índice UNIQUE parcial `(reserva_id, codigo_email, subtipo) WHERE
  estado = 'enviado' AND es_reenvio = false AND codigo_email <> 'manual'` → **TDD del caso de
  uso primero** (unit) + **integración con Postgres real** desde la sesión principal.

## Fuentes

- Petición de producto (esta conversación): botón "Solicitar datos", visibilidad condicionada,
  idempotencia una-sola-vez, cierre de modal + scroll + banner + refresco de Comunicaciones.
- Plantilla reutilizada: `apps/api/src/reservas/application/plantilla-transicion-fecha.ts`
  (`renderDisponibleES` líneas 89-115, `renderDisponibleCA` líneas 61-87;
  `renderMensajeTransicionFecha`).
- Idempotencia y `subtipo`: `apps/api/prisma/schema.prisma` (`enum SubtipoEmail` líneas
  173-179; modelo `COMUNICACION` e índice UNIQUE parcial líneas ~662-695); spec viva
  `comunicaciones` "Idempotencia de un email por reserva y código".
- Patrón borrador: `DespacharEmailService.despachar({ autoenviar: false })`.
- Idioma de la reserva: `Reserva.idioma` (`apps/api/prisma/schema.prisma` ~378, `'es' | 'ca'`).
- Datos fiscales del CLIENTE: modelo `Cliente` (`schema.prisma` ~310-333); frontend
  `apps/web/src/features/presupuestos/lib/datosFiscalesCampos.ts` (`CAMPOS_FISCALES`,
  `camposFiscalesFaltantes`).
- Flujo existente de enviar borrador + banner: `ComunicacionesCard.onEmailEnviado →
  SeccionesFicha → useAvisosFicha.mostrarEmailEnviado`
  (`apps/web/src/features/reservas/pages/FichaConsulta/useAvisosFicha.ts`).
- Patrón de banner emerald: `AvisoFacturaSenalEnviada.tsx` y
  `useAvisosFicha.mostrarFacturaSenalEnviada`.
