# Change: presupuesto-datos-fiscales-cliente-inline

## Why

Al confirmar un presupuesto (US-014 / UC-14), el sistema valida de forma síncrona
que el CLIENTE tiene **todos** sus datos fiscales no nulos y no vacíos
(`dni_nif`, `direccion`, `codigo_postal`, `poblacion`, `provincia`); si falta
alguno, aborta con `DATOS_FISCALES_INCOMPLETOS` (HTTP 422) enumerando
`camposFaltantes`. (`US-014 §FA-01`, `§Reglas de Validación`; capability
`presupuestos`, requirement "Validación síncrona de completitud de datos y datos
fiscales antes del cálculo".)

Hoy **no existe** ningún endpoint ni UI para editar esos datos del CLIENTE tras
crear la RESERVA: el único PATCH sobre el CLIENTE es
`PATCH /reservas/{id}/iban-devolucion` (US-035), que solo escribe
`iban_devolucion`. En consecuencia, cuando el gestor topa con
`DATOS_FISCALES_INCOMPLETOS` **no tiene forma de resolverlo dentro del flujo** y
el presupuesto queda bloqueado. Es la incidencia **#5** de los ajustes al paso
"Generar presupuesto" (Parte B; la Parte A ya está en master — PR #61).

Este change resuelve el bloqueo **inline dentro del diálogo de presupuesto**
(`GenerarPresupuestoDialog`): añade un endpoint dedicado para completar los datos
fiscales del CLIENTE y la sección de UI que los precarga, edita y guarda antes de
confirmar.

## What Changes

- **Nuevo endpoint `PATCH /reservas/{id}/datos-fiscales`** que actualiza
  **únicamente** los campos fiscales del CLIENTE asociado a la RESERVA `{id}`:
  `dni_nif`, `direccion`, `codigo_postal`, `poblacion`, `provincia` (todos
  `nullable` en el schema Prisma). Devuelve el estado resultante de esos campos.
  (Analogía de contrato/patrón: `PATCH /reservas/{id}/iban-devolucion`, US-035.)
- **Multi-tenant + RLS + rol**: `tenant_id` SIEMPRE del JWT (nunca del body); el
  CLIENTE se resuelve por la RESERVA `{id}` bajo el contexto RLS del tenant; una
  RESERVA de otro tenant → 404. Protegido con `@Roles('gestor')` (mismo patrón que
  el resto del flujo de presupuesto y que `iban-devolucion`).
- **Arquitectura hexagonal/DDD**: caso de uso de aplicación + puerto de escritura +
  adaptador Prisma; `domain/` sin imports de framework/infra. No introduce
  máquina de estados ni bloqueo de fecha (no toca `FECHA_BLOQUEADA` ni el estado
  de la RESERVA).
- **Contrato OpenAPI + SDK** (fase siguiente, `contract-engineer`): se añade el path
  a `docs/api-spec.yml` y se **regenera** el SDK del frontend (nunca a mano). Este
  change de spec **no** edita `api-spec.yml`.
- **Frontend** (fase de implementación): sección "Datos fiscales del cliente"
  dentro de `GenerarPresupuestoDialog` que precarga los datos existentes, permite
  completarlos y los guarda (PATCH, TanStack Query `useMutation`) antes/al
  confirmar el presupuesto; al recibir `DATOS_FISCALES_INCOMPLETOS`, resalta/enfoca
  los campos que faltan (`camposFaltantes`). RHF + Zod, mobile-first (390/768/1280).

## Alcance (decidido — no ampliar)

- **Solo datos del CLIENTE.** El endpoint edita exclusivamente
  `dni_nif`/`direccion`/`codigo_postal`/`poblacion`/`provincia`.
- Los campos de la **RESERVA** (`fecha_evento`, `duracion_horas`,
  `num_adultos_ninos_mayores4`, `tipo_evento`) se **asumen ya fijados** por sus
  flujos propios y **NO** se incluyen en este change. En particular la fecha tiene
  su flujo de bloqueo atómico dedicado (`POST /reservas/{id}/fecha`); tocarla aquí
  violaría la regla de bloqueo atómico de fecha (`CLAUDE.md §Regla crítica`).

## Impact

- **Specs afectadas**: capability **`presupuestos`** (viva) — se AÑADE un
  requirement de edición inline de datos fiscales del CLIENTE. No modifica
  `consultas`, `bloqueo-fecha` ni `calculo-tarifa`.
- **Datos**: ninguna migración. Reutiliza los campos ya existentes y `nullable` de
  `Cliente` (`dni_nif`, `direccion`, `codigo_postal`, `poblacion`, `provincia`).
- **Contrato OpenAPI**: nuevo path `PATCH /reservas/{id}/datos-fiscales` (lo aporta
  `contract-engineer` en la fase de contrato) + regeneración del SDK.
- **Código** (implementación posterior): módulo `presupuestos` (o `reservas`, según
  patrón del módulo donde vive `iban-devolucion`) en `apps/api` — controller +
  use-case + puerto + adaptador Prisma; sección de UI en `apps/web`
  `features/presupuestos/components/GenerarPresupuestoDialog.tsx`.
- **Trazabilidad**: **US-014** (UC-14, §FA-01, §Reglas de Validación), incidencia
  **#5** del plan `en-el-paso-de-zippy-dragon.md`; dolores **D8**/**D3**.
- **Fuera de alcance**: edición de campos de la RESERVA (fecha/duración/invitados/
  tipo), creación de FACTURA, cambios en el motor de tarifa, y la generación del PDF
  (US-014 ya lo cubre). No toca `FECHA_BLOQUEADA` ni la máquina de estados.
- **Concurrencia**: ninguna zona crítica propia — es un UPDATE de campos escalares
  del CLIENTE, no participa del bloqueo atómico de fecha.
