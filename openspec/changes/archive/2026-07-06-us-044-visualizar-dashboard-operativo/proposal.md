# Change: us-044-visualizar-dashboard-operativo

## Why

US-044 (UC-34, prioridad **Alta**) entrega el **Dashboard Operativo**: una vista
accesible desde su propia entrada del sidebar del App Shell (el Calendario
permanece como pantalla de inicio tras el login) que agrega el estado actual de
todas las reservas del tenant en **7 widgets temáticos** (§7.1
SlotifyGeneralSpecs), sin navegar ficha a ficha.

Resuelve tres dolores: **D7** (sin dashboards — decisiones por intuición),
**D2** (cero visibilidad del pipeline — imposible priorizar follow-ups) y
**D11** (sin recordatorios estructurados — pagos atrasados y TTLs próximos que
no se detectan a tiempo). El gestor pasa de rastrear el estado del negocio en
Gmail/Sheets/WhatsApp (~15 min) a verlo en una pantalla unificada (segundos).
(Fuente: `US-044 §Historia`, `§Contexto de Negocio`, `§Impacto de Negocio`.)

Es una **vista de lectura pura**: NO muta estado, NO produce bloqueos, NO tiene
concurrencia. Refleja el estado actual de `RESERVA` y entidades relacionadas
(`FECHA_BLOQUEADA`, `PRESUPUESTO`, `FACTURA`, `PAGO`, `FICHA_OPERATIVA`)
filtrado por el `tenant_id` del JWT y con RLS. Todos esos datos son escritos por
otras historias (US-003 a US-043); esta vista solo los agrega y presenta.
(Fuente: `US-044 §Contexto`, `§Concurrencia / Race Conditions`.)

> Dependencia dura satisfecha: **US-001** (sesión activa con `tenant_id` en el
> JWT) ya está implementada. La vista puede desarrollarse con datos de prueba;
> el resto de historias que alimentan los datos son opcionales para construirla.

## What Changes

> Alcance estricto: **vista de lectura agregada**. NO escribe ninguna entidad;
> NO expone datos financieros del tenant ni `CLIENTE.iban_devolucion` (§7.2,
> fuera de MVP); NO implementa KPIs avanzados ni "clientes recurrentes".
> (Fuente: `US-044 §Notas de alcance`, `§Reglas de Validación`.)

- **Endpoint de lectura agregado del dashboard** (capability nueva `dashboard`):
  devuelve, filtrado por `tenant_id` del JWT + RLS y solo con `activo = true`,
  los datos de los **7 widgets** de §7.1:
  1. **Hoy y mañana** — reservas con `fecha_evento` = hoy/mañana en
     `reserva_confirmada` o `evento_en_curso`, con cliente, tipo de evento,
     estado y hora de inicio, ordenadas por `fecha_evento` ascendente.
  2. **Pipeline** — recuento de reservas agrupado por `estado`/`sub_estado` con
     etiquetas legibles (Exploratoria, Con fecha, Pendiente invitados, En cola,
     Visita programada, Pre-reserva, Confirmada).
  3. **Sub-procesos críticos** — reservas en `reserva_confirmada` con sub-proceso
     atrasado: `pre_evento_status ≠ cerrado` con evento próximo,
     `liquidacion_status ≠ cobrada` o `fianza_status ≠ cobrada`, con indicador
     del sub-proceso pendiente y fecha del evento.
  4. **Pendientes** — presupuestos `enviado` sin respuesta, TTLs con
     `ttl_expiracion` en las próximas 24 h, o facturas `enviada` sin `PAGO` con
     vencimiento superado; cada ítem con la acción requerida y enlace a la reserva.
  5. **Consultas en cola** — reservas en `sub_estado = 2d`, agrupadas por
     `fecha_evento`, con `posicion_cola`, cliente y tiempo acumulado en cola
     (desde `fecha_creacion`).
  6. **Visitas programadas** — reservas en `sub_estado = 2v` con
     `visita_programada_fecha` futura, ordenadas ascendente, con cliente y fecha/hora.
  7. **Próximos 30 días** — reservas con `fecha_evento` en `[hoy, hoy + 30 días]`
     representadas como mini-calendario coloreado por estado, reutilizando el
     **código de colores canónico del Calendario (US-039 / SlotifyGeneralSpecs
     §11.3)**.
  (Fuente: `US-044 §Happy Path`, `§Reglas de Negocio`, `§Reglas de Validación`.)
- **Estado vacío por widget** (FA-01): cada widget gestiona su propio estado
  vacío de forma independiente; la ausencia de datos en uno no bloquea a los
  demás. (Fuente: `US-044 §FA-01`.)
- **Reutilización del código de colores del Calendario** (US-039): el widget
  "Próximos 30 días" usa la **misma derivación de color** (gris consulta activa,
  ámbar pre_reserva, verde confirmada/en_curso/post_evento, azul completada,
  rojo cancelada) — no se duplica la lógica. (Fuente: `US-044 §Reglas de Negocio`.)
- **Dashboard en el frontend como nueva entrada del sidebar** (el Calendario
  sigue siendo la landing post-login; el Dashboard no es la pantalla de inicio):
  grid responsive de los 7 widgets (mobile-first 390/768/1280). Cada ítem enlaza
  a la ficha de la `RESERVA`; el mini-calendario enlaza al Calendario completo
  (US-039) con la fecha seleccionada. (Fuente: `US-044 §FA-02`, `§FA-03`;
  `CLAUDE.md` regla responsive; decisión del gate SDD sobre el slot de inicio.)

## Impact

- Specs afectadas: **nueva capability `dashboard`** (vista de lectura agregada
  operativa). Reutiliza la derivación de color de `calendario` (US-039) para el
  widget "Próximos 30 días". No modifica `calendario`, `consultas`,
  `presupuestos`, `facturacion`, `ficha-operativa`, `bloqueo-fecha` ni `app-shell`.
- Código afectado (implementación posterior, fuera de este change de spec):
  - Backend: `apps/api/src/dashboard/**` (controller + use-case de lectura
    agregada de los 7 widgets + adaptador de query Prisma con RLS por `tenant_id`;
    reutiliza la función pura de derivación de color de `calendario`).
  - Contrato: nuevo `GET /dashboard` en `docs/api-spec.yml`; SDK regenerado.
  - Frontend: `apps/web/src/features/dashboard/**` (página, componentes de los 7
    widgets, estados vacíos, enlaces a ficha y al calendario) y **nueva entrada
    "Dashboard" en el sidebar del App Shell** (sin cambiar la landing, que sigue
    siendo el Calendario).
- Trazabilidad: **US-044**, **UC-34**; widgets §7.1 SlotifyGeneralSpecs; código
  de colores §11.3 / US-039; entidades `RESERVA`, `FECHA_BLOQUEADA`,
  `PRESUPUESTO`, `FACTURA`, `PAGO`, `FICHA_OPERATIVA` (`er-diagram.md`).
- Dependencias: **US-001** (sesión con `tenant_id` en JWT — implementada). Lee
  datos escritos por US-003..US-043; no requiere que estén implementadas para
  construir la vista (datos de prueba).
- **No-objetivos (fuera de alcance):**
  - **Dashboard financiero + KPIs avanzados (§7.2)** — `📐 Solo diseñado`:
    ingresos, ocupación, ticket medio, ratio de conversión, estacionalidad, tasa
    de demanda saturada, cobros pendientes financieros, comparativas interanuales.
  - **Histórico de reservas (§7.3)** — cubierto por US-042 (búsqueda) y US-043
    (exportación CSV); no se duplica.
  - **Filtro "clientes recurrentes"** (§7.3, `consulta_vinculo`) — `📐 Solo diseñado`.
  - Cualquier **mutación de estado** de `RESERVA` o entidades relacionadas.
  - **Concurrencia / race conditions**: no aplica (lectura pura; sin tests de
    race condition propios). (Fuente: `US-044 §Concurrencia / Race Conditions`.)
