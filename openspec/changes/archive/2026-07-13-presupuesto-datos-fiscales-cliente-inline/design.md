# Design — presupuesto-datos-fiscales-cliente-inline

## Contexto

Incidencia #5 (Parte B) de los ajustes al paso "Generar presupuesto" (US-014).
La validación fiscal síncrona ya existe en el backend
(`GenerarPresupuestoUseCase` → `DatosFiscalesIncompletosError`,
`codigo='DATOS_FISCALES_INCOMPLETOS'`, `camposFaltantes[]`, 422), pero **no hay
forma de completar esos datos**. Este change añade el medio (endpoint + UI inline).

## Decisiones

### D-1 — Endpoint dedicado `PATCH /reservas/{id}/datos-fiscales` (no un PUT de CLIENTE)

Se sigue el patrón ya establecido para mutar campos del CLIENTE en el contexto de
una RESERVA: `PATCH /reservas/{id}/iban-devolucion` (US-035). El `{id}` es la
RESERVA; el CLIENTE se resuelve **a través de** ella bajo RLS del tenant del JWT.
Ventajas: consistencia con el flujo existente, tenant/actor derivados del JWT,
autorización por acción del gestor, y no se expone un CRUD genérico de CLIENTE.
Alternativa descartada: `PATCH /clientes/{id}` genérico — abre superficie mayor de
la necesaria y rompe el patrón "acción contextualizada en la RESERVA".

### D-2 — Semántica de actualización parcial (PATCH), sin borrado por omisión

El body admite los 5 campos como opcionales. **Solo** se actualizan los campos
presentes en el body; los ausentes **no** se tocan (no se sobrescriben a `null`).
Así el diálogo puede enviar solo lo que el gestor completa sin perder datos previos.
Cadena vacía / whitespace se trata como "no informado" coherentemente con la
validación de US-014 (que exige no nulo **y no vacío**): el frontend no debe enviar
strings vacíos como valor válido; el criterio exacto de normalización (trim, rechazo
de vacío) se fija en la fase de contrato/impl. Los 5 campos son de texto libre; no se
valida formato de `dni_nif`/`codigo_postal` en este change (fuera de alcance — la US
solo exige "no nulo, no vacío").

### D-3 — Alcance estrictamente CLIENTE; la RESERVA no se toca aquí

Los campos de evento de la RESERVA (`fecha_evento`, `duracion_horas`,
`num_adultos_ninos_mayores4`, `tipo_evento`) quedan fuera. La fecha, en particular,
solo puede cambiar por su flujo de bloqueo atómico (`POST /reservas/{id}/fecha`);
editarla aquí violaría `CLAUDE.md §Regla crítica: bloqueo atómico de fecha`. El
endpoint es un UPDATE de columnas escalares del CLIENTE: **no** entra en la máquina
de estados, **no** abre transacción con `SELECT … FOR UPDATE` sobre `FECHA_BLOQUEADA`
ni tiene zona crítica de concurrencia propia.

### D-4 — Ubicación del código (hexagonal/DDD)

`iban-devolucion` vive en el módulo `reservas` (`apps/api/src/reservas/{interface,
application,infrastructure}`). Este endpoint es análogo (mutación de campos del
CLIENTE contextualizada en la RESERVA) y **conceptualmente** sirve al flujo de
presupuesto. La decisión de módulo (`reservas` vs `presupuestos`) se confirma en la
fase de implementación siguiendo el patrón del módulo donde encaje mejor la carga de
CLIENTE por RESERVA; la spec vive en la capability `presupuestos` por su propósito
funcional. Estructura: controller (interface) → use-case (application) → puerto de
escritura (domain) → adaptador Prisma (infrastructure). `domain/` sin framework/infra
(hook `no-infra-in-domain`).

### D-5 — Bucle de resolución en el frontend con `camposFaltantes`

El diálogo (`GenerarPresupuestoDialog`) muestra la sección "Datos fiscales del
cliente" precargando los 5 campos del CLIENTE. Al recibir `DATOS_FISCALES_INCOMPLETOS`
(422) en el preview/confirmación, el frontend usa `camposFaltantes[]` (ya devuelto por
el contrato, `PresupuestoDatosFiscalesError`) para **resaltar/enfocar** los inputs que
faltan. El PATCH se dispara antes/al confirmar (TanStack Query `useMutation`); tras el
guardado exitoso se reintenta la generación. RHF + Zod, mobile-first (390/768/1280),
sin overflow horizontal. El cliente HTTP se **genera** desde el contrato — no se edita
a mano (dueño: `contract-engineer`).

## Mapeo de errores (previsto para la fase de contrato)

- **404** — RESERVA inexistente o de otro tenant (RLS): coherente con
  `iban-devolucion`.
- **400** — body mal formado (tipos inválidos).
- **401 / 403** — no autenticado / autenticado sin rol `gestor`.
- **200** — datos fiscales actualizados; devuelve el estado resultante de los 5
  campos del CLIENTE.

## Riesgos / notas

- **Lección US-049 (memoria)**: verificar el endpoint contra **BD real con datos
  sembrados**, no solo mocks — la QA con curl y el test de integración SQL se
  ejecutan desde la **sesión principal** (que sí tiene Postgres); los subagentes no
  tienen Docker/Postgres. El `tasks.md` lo refleja.
- No hay migración de schema: los 5 campos ya existen y son `nullable` en `Cliente`.
