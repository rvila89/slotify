# 🧾 Historia de Usuario: Visualizar Dashboard Operativo

## 🆔 Metadatos
- ID: US-044
- Área funcional: Dashboard
- Módulo: M10
- Prioridad: Alta
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Gestor
**Quiero** visualizar el dashboard operativo con el estado actual de todas las reservas agrupado en widgets temáticos
**Para** tener visibilidad inmediata del pipeline, los pendientes urgentes, los sub-procesos críticos y las visitas próximas sin tener que navegar ficha a ficha

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-34
- Entidades implicadas: `RESERVA`, `FECHA_BLOQUEADA`, `PRESUPUESTO`, `FACTURA`, `PAGO`, `FICHA_OPERATIVA`
- Dolor(es) que resuelve: D7 (sin dashboards — decisiones por intuición sin datos), D2 (cero visibilidad del pipeline — imposible priorizar follow-ups), D11 (sin recordatorios estructurados — pagos atrasados y TTLs próximos no se detectan a tiempo)
- Automatización relacionada: ninguna directa (vista de lectura agregada; las automatizaciones A-xx que alimentan los datos están cubiertas en sus historias respectivas)
- Email relacionado: ninguno
- Reglas de negocio:
  - El dashboard muestra los 7 widgets definidos en §7.1 de SlotifyGeneralSpecs: **Hoy y mañana**, **Pipeline**, **Sub-procesos críticos**, **Pendientes**, **Consultas en cola**, **Visitas programadas**, **Próximos 30 días**.
  - Todos los datos corresponden exclusivamente al tenant del gestor autenticado (`tenant_id` tomado del JWT en cada consulta).
  - Cada item de cualquier widget enlaza a la ficha de la `RESERVA` correspondiente.
  - El widget "Próximos 30 días" usa el mismo código de colores que el Calendario (US-039): gris = consulta activa, ámbar = pre_reserva, verde = reserva_confirmada/evento_en_curso/post_evento, azul = reserva_completada, rojo = reserva_cancelada.
  - Solo se muestran reservas con `activo = true`.
  - El dashboard es una vista de lectura pura: no produce ninguna mutación de datos.
- Supuestos: la pantalla de Dashboard es la pantalla de inicio por defecto tras el login (alineado con UC-01 flujo básico paso 6 y la estructura de navegación de §1.4 use-cases.md).
- Dependencias: US-001 (sesión activa con `tenant_id` en JWT). Los datos mostrados en los widgets son generados por el resto de historias (US-003 a US-043), pero la vista puede desarrollarse en paralelo con datos de prueba.
- Notas de alcance:
  - **Dashboard financiero + KPIs avanzados (§7.2 SlotifyGeneralSpecs)** — `📐 Solo diseñado`. Fuera de este MVP. No se incluyen widgets de ingresos, ocupación, ticket medio, ratio de conversión, estacionalidad, tasa de demanda saturada, cobros pendientes financieros ni comparativas interanuales.
  - **Histórico de reservas (§7.3 SlotifyGeneralSpecs)** — cubierto por UC-32/US-042 (búsqueda y filtrado) y UC-33/US-043 (exportación CSV). No se duplica aquí.
  - **Filtro "clientes recurrentes"** mencionado en §7.3 — `📐 Solo diseñado`. La detección automática de leads recurrentes (`consulta_vinculo`) no está en el MVP.

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path

- **Dado** que el gestor está autenticado en el sistema
  **Cuando** navega al Dashboard (opción "Dashboard" del menú lateral)
  **Entonces** el sistema renderiza los 7 widgets de §7.1 con datos actualizados del tenant: Hoy y mañana, Pipeline, Sub-procesos críticos, Pendientes, Consultas en cola, Visitas programadas, Próximos 30 días.

- **Dado** que existen reservas con `fecha_evento` igual a hoy o mañana en estados `reserva_confirmada` o `evento_en_curso`
  **Cuando** el gestor visualiza el widget **"Hoy y mañana"**
  **Entonces** aparecen dichas reservas con nombre del cliente, tipo de evento, estado actual y hora de inicio, ordenadas por `fecha_evento` ascendente.

- **Dado** que existen consultas en sub-estados `2a`, `2b`, `2c`, `2d`, `2v`, reservas en `pre_reserva` y en `reserva_confirmada`
  **Cuando** el gestor visualiza el widget **"Pipeline"**
  **Entonces** el widget muestra el recuento de reservas agrupado por `estado`/`sub_estado` con etiquetas legibles (p. ej. "Exploratoria", "Con fecha", "Pendiente invitados", "En cola", "Visita programada", "Pre-reserva", "Confirmada").

- **Dado** que existen reservas en `reserva_confirmada` con alguno de los sub-procesos atrasados: `pre_evento_status ≠ cerrado` con fecha del evento próxima, `liquidacion_status ≠ cobrada`, o `fianza_status ≠ cobrada`
  **Cuando** el gestor visualiza el widget **"Sub-procesos críticos"**
  **Entonces** aparecen esas reservas con indicador visual del sub-proceso pendiente (pre-evento / liquidación / fianza) y la fecha del evento para facilitar la priorización.

- **Dado** que existen presupuestos con `estado = 'enviado'` sin respuesta, TTLs con `ttl_expiracion` dentro de las próximas 24 horas, o facturas con `estado = 'enviada'` sin pago registrado con fecha de vencimiento superada
  **Cuando** el gestor visualiza el widget **"Pendientes"**
  **Entonces** el widget lista cada acción pendiente con descripción de la acción requerida y enlace directo a la reserva correspondiente.

- **Dado** que existen reservas con `sub_estado = '2d'`
  **Cuando** el gestor visualiza el widget **"Consultas en cola"**
  **Entonces** aparecen agrupadas por `fecha_evento` con el `posicion_cola` de cada consulta, el nombre del cliente y el tiempo acumulado en cola (calculado desde `fecha_creacion` del registro).

- **Dado** que existen reservas con `sub_estado = '2v'` y `visita_programada_fecha` futura
  **Cuando** el gestor visualiza el widget **"Visitas programadas"**
  **Entonces** se listan ordenadas por `visita_programada_fecha` ascendente con nombre del cliente y fecha/hora de la visita.

- **Dado** que existen reservas con `fecha_evento` dentro del rango `[hoy, hoy + 30 días]`
  **Cuando** el gestor visualiza el widget **"Próximos 30 días"**
  **Entonces** se muestra un mini-calendario donde cada fecha aparece coloreada según el estado de la reserva que la ocupa, usando el mismo código cromático que el Calendario completo (US-039).

### ⚠️ Flujos Alternativos y Edge Cases

#### FA-01 / Widget sin datos (estado vacío)
- **Dado** que no existen reservas que satisfagan los criterios de un widget concreto (p. ej. ningún evento hoy ni mañana, ninguna consulta en cola)
  **Cuando** el gestor visualiza ese widget
  **Entonces** el widget se renderiza con un mensaje de estado vacío descriptivo (p. ej. "No hay eventos hoy ni mañana") sin errores de interfaz, y el resto de widgets muestran sus datos con normalidad.
- Comportamiento del sistema: cada widget gestiona su propio estado vacío de forma independiente; la carga de un widget no bloquea ni afecta a los demás.

#### FA-02 / Navegación a ficha desde widget
- **Dado** que el gestor visualiza un ítem en cualquier widget (p. ej. una reserva en "Sub-procesos críticos")
  **Cuando** hace clic sobre ese ítem
  **Entonces** el sistema navega a la ficha de detalle de esa `RESERVA`, y al volver (botón atrás del navegador) recupera el dashboard en la posición de scroll anterior.
- Comportamiento del sistema: enlace directo a la ficha; la navegación de retorno es gestionada por el historial del navegador.

#### FA-03 / Navegación al Calendario completo desde "Próximos 30 días"
- **Dado** que el gestor hace clic sobre una fecha del mini-calendario "Próximos 30 días"
  **Cuando** esa fecha tiene al menos una reserva asociada
  **Entonces** el sistema navega al Calendario completo (UC-29/US-039) con esa fecha resaltada o seleccionada.
- Comportamiento del sistema: el mini-calendario actúa como punto de entrada al módulo Calendario; no duplica la lógica de disponibilidad.

#### FA-04 / Aislamiento multi-tenant
- **Dado** que el gestor del tenant X está autenticado
  **Cuando** el sistema construye las consultas de todos los widgets del dashboard
  **Entonces** todas las queries incluyen `WHERE tenant_id = :tenantId` (extraído del payload JWT), y ningún dato del tenant Y aparece en ningún widget.
- Comportamiento del sistema: `tenant_id` inyectado en capa de repositorio para cada consulta; no gestionable por el usuario.

### 🔒 Concurrencia / Race Conditions
No aplica. El dashboard es una vista de lectura pura sobre `RESERVA` y entidades relacionadas. No produce mutaciones de datos ni bloqueos. Las consultas de múltiples widgets pueden ejecutarse en paralelo de forma segura sin riesgo de race condition.

### 🚫 Reglas de Validación
- Solo el gestor autenticado puede acceder al dashboard de su tenant (`tenant_id` verificado en cada query).
- Los recuentos del widget "Pipeline" incluyen únicamente reservas con `activo = true`.
- El widget "Próximos 30 días" cubre `fecha_evento BETWEEN today AND today + 30 days` (inclusive).
- El dashboard **no expone** datos financieros del tenant ni `CLIENTE.iban_devolucion` (cubiertos en §7.2, fuera del MVP).
- El dashboard es de solo lectura: no permite modificar ningún dato directamente desde los widgets; toda acción requiere navegar a la ficha de reserva.

## 📊 Impacto de Negocio
- Impacto esperado: el gestor pasa de gestionar por intuición con Gmail, Sheets y WhatsApp dispersos (D7) a tener visibilidad completa del estado del negocio en una pantalla unificada; reduce el tiempo de localización de acciones urgentes (TTLs, pagos pendientes, visitas del día, sub-procesos atrasados) de aproximadamente 15 minutos a segundos.
- Criterio de éxito: el gestor puede identificar todas las acciones urgentes del día directamente desde el dashboard sin abrir ninguna ficha individual; objetivo operativo: cero acciones vencidas (pagos no detectados, TTLs expirados sin gestión) en días con actividad de reservas, medible por ausencia de reservas con `ttl_expiracion < now` en estado activo que no aparezcan en el widget "Pendientes".
