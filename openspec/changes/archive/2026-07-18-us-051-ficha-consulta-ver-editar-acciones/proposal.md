# Change: us-051-ficha-consulta-ver-editar-acciones

## Why

**US-051 — Ficha de consulta: ver detalles, editar, y sanear acciones** (Área:
Consultas / Presupuestos; ficha de la RESERVA — `FichaConsultaPage`). El uso real de la
ficha de una consulta/reserva ha revelado cuatro carencias que degradan la operativa del
gestor y le impiden trabajar el lead sin salirse del flujo:

1. **La ficha no muestra los datos del evento que ya existen en la RESERVA.** Hoy
   `FichaConsultaPage` pinta tipo de evento, fecha del evento y visita programada, pero
   **omite** la duración (`duracionHoras`), el nº de invitados
   (`numAdultosNinosMayores4` / `numNinosMenores4` / `numInvitadosFinal`), la hora de
   inicio (`horario`) y los comentarios (`notas`). El gestor no puede revisar en la ficha
   la información que el propio sistema ya guarda. (Fuente: `US-051 §Punto 1`;
   `er-diagram §3.6 RESERVA`; spec viva `consultas` "Idioma y horario opcionales en el
   alta de consulta".)

2. **No se pueden editar los datos de una consulta/reserva.** Si el cliente cambia de
   idea (p. ej. de 30 a 20 invitados, o distinta duración), el gestor no tiene forma de
   corregirlo desde la ficha: no existe editor en el frontend y el backend **no
   implementa** el `PATCH /reservas/{id}` que el contrato ya declara
   (`UpdateReservaRequest`, `api-spec.yml §~300`). (Fuente: `US-051 §Punto 2`;
   `api-spec.yml PATCH /reservas/{id}`; `er-diagram §3.6 RESERVA`.)

3. **"Generar presupuesto" se ofrece sin comprobar que los datos estén completos.** Hoy
   el botón se habilita solo por estado/sub-estado (`puedeGenerarPresupuesto` mira
   únicamente `estado='consulta'` y `subEstado ∈ {2a,2b,2c,2v}`), y luego el backend
   lanza **422 en cascada** (falta fecha, duración, invitados, datos fiscales) sin que el
   gestor pueda corregir (no hay editor). El gestor choca contra un muro y no sabe qué
   falta. (Fuente: `US-051 §Punto 3`; spec viva `presupuestos` "Validación síncrona de
   completitud de datos y datos fiscales antes del cálculo"; UC-14.)

4. **Las consultas cerradas siguen pintando botones deshabilitados.** En sub-estados
   terminales (`2x` / `2y` / `2z`) y estados terminales (`reserva_cancelada`,
   `reserva_completada`) la ficha todavía renderiza acciones deshabilitadas ("Descartar",
   "Generar presupuesto") con su motivo, cuando no hay **ninguna** acción posible. Debería
   mostrar solo el fallback "No hay acciones disponibles". (Fuente: `US-051 §Punto 4`;
   spec viva `consultas`; `AccionesConsulta.tsx`.)

Los cuatro puntos giran alrededor de la ficha de la RESERVA y de una misma raíz: al
gestor le falta **ver** y **corregir** los datos del lead antes de avanzarlo, y las
acciones que se le ofrecen deben corresponder de verdad con lo que puede hacer.

### Fuera de alcance (decisión de producto)

**Programar una visita sin fecha del evento** queda EXPLÍCITAMENTE FUERA DE ALCANCE de
esta US (decisión del usuario). Tocaba el bloqueo atómico de fecha y la máquina de
estados y se abordará en un change propio.

## What Changes

### Punto 1 — Visualización completa de los detalles del evento (capability `consultas`)
- La ficha muestra **todos** los datos del evento presentes en la RESERVA: tipo de
  evento, fecha del evento, **duración** (`duracionHoras`), **nº de invitados**
  (`numAdultosNinosMayores4`, `numNinosMenores4`, `numInvitadosFinal`), **hora de inicio**
  (`horario`), visita programada y **comentarios** (`notas`).
- Para los campos **opcionales ausentes**, muestra un placeholder tipo "De momento no se
  dispone de esta información" en lugar de omitirlos.

### Punto 2 — Editar los datos de una consulta/reserva (capability `consultas`)
- Se implementa el caso de uso + controller de `PATCH /reservas/{id}` (hoy solo en el
  contrato). Campos editables: `tipoEvento`, `duracionHoras`, nº de invitados
  (`numAdultosNinosMayores4`, `numNinosMenores4`, `numInvitadosFinal`), `notas` y **hora
  de inicio** (`horario`). RLS por tenant + `AUDIT_LOG` (`accion='actualizar'`).
- **REGLA ARQUITECTÓNICA CRÍTICA — la fecha del evento NO se muta por el PATCH genérico.**
  Toda mutación de fecha pasa por el bloqueo atómico (`bloquearFecha()`/`liberarFecha()`,
  `SELECT … FOR UPDATE` + `UNIQUE(tenant_id, fecha)`):
  - Consulta en `2a` (sin fecha): la fecha se asigna reutilizando el flujo existente
    `POST /reservas/{id}/fecha` (transición `2a → 2b/2d` con cola).
  - **Cambiar una fecha YA bloqueada** (`2b` / `2c` / `2v`): operación atómica NUEVA
    "cambiar fecha" = liberar la antigua + bloquear la nueva en UNA transacción, con
    manejo de cola. Es la parte de mayor riesgo → exige TDD de concurrencia primero
    (patrón `atomic-date-lock`). El `design.md` deja constancia de que, si el gate quiere
    acotar el alcance, la edición de fecha puede diferirse dejándola editable **solo en
    `2a`** (vía el flujo existente).

### Punto 3 — Gating de "Generar presupuesto" por completitud (capability `presupuestos`)
- "Generar presupuesto" NO se ofrece / se deshabilita hasta que estén presentes:
  `fechaEvento` + nº de invitados (`numAdultosNinosMayores4`) + `duracionHoras` + **hora
  de inicio** (`horario`). Se indica **qué falta** y se sugiere "Editar consulta".
- El botón sigue supeditado a la guarda de estado/sub-estado existente (no cambia): la
  completitud es una condición **adicional**.

### Punto 4 — Consulta cerrada → sin acciones (capability `consultas`)
- En sub-estados terminales (`2x` / `2y` / `2z`) y estados terminales
  (`reserva_cancelada`, `reserva_completada`) la ficha NO ofrece **ninguna** acción (ni
  deshabilitada): solo el fallback "No hay acciones disponibles para esta consulta en su
  estado actual."

### Contrato (lo ejecutará `contract-engineer` tras el gate)
- Exponer `horario` (pattern `^\d{2}:\d{2}$`) en el schema de respuesta `Reserva` y en
  `UpdateReservaRequest` (hoy ausente en ambos).
- `PATCH /reservas/{id}` ya existe en `docs/api-spec.yml` (~línea 300); solo hay que
  implementar el backend (caso de uso + controller, patrón de
  `actualizar-datos-fiscales-cliente.controller.ts`).

## Impact

- **Specs afectadas**:
  - `specs/consultas/spec.md` — ADDED "Visualización completa de detalles del evento en
    la ficha"; ADDED "Edición de datos de una consulta/reserva" (PATCH de campos simples +
    fecha vía flujo atómico); ADDED "Sin acciones en consultas cerradas (terminales)".
  - `specs/presupuestos/spec.md` — MODIFIED "'Generar presupuesto' requiere completitud de
    datos (fecha, invitados, duración, hora de inicio)".
- **Código afectado (tras el gate; no en este change)**:
  - Backend: nuevo `ActualizarReservaUseCase` + `PatchReservaController` (RLS + AUDIT_LOG);
    para "cambiar fecha" bloqueada, nueva operación atómica bajo `bloquearFecha`/
    `liberarFecha` con manejo de cola (US-005/US-018 como referencia).
  - Frontend: ficha (`FichaConsultaPage`, secciones de datos del evento), editor de
    consulta (formulario TanStack), gating de "Generar presupuesto" por completitud,
    saneo de acciones en terminales (`AccionesConsulta`, `AccionPresupuesto`,
    `AccionDescartar`).
  - Contrato: `Reserva.horario` + `UpdateReservaRequest.horario`; SDK regenerado.
- **NO reimplementa**: el transporte de email, la máquina de estados, ni el bloqueo
  atómico de fecha (lo **reutiliza** para la operación "cambiar fecha").
- **Riesgo principal**: la operación atómica "cambiar fecha" (liberar + bloquear + cola en
  una transacción) — mitigado con TDD de concurrencia primero y con la opción de
  diferirla a `2a` si el gate lo decide.
