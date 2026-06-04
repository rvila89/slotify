# Matriz de Trazabilidad — Slotify MVP

> Artefacto de verificación obligatorio según `generate-user-story.prompt.md`.  
> Se completa por lotes. Cada lote añade las filas del área funcional cubierta.

---

## Estado de cobertura global

| Lote | Área funcional | UC cubiertos | Historias generadas | Estado |
|------|----------------|-------------|---------------------|--------|
| 0 | **Infraestructura / Fundación técnica** | *(ningún UC — prerequisito técnico)* | US-000 | ✅ Completo |
| 0b | **Infraestructura / App Shell** | *(ningún UC — prerequisito de UI)* | US-000A | ✅ Completo |
| 1 | Autenticación | UC-01, UC-02 | US-001, US-002 | ✅ Completo |
| 2a | Gestión de Leads y Consultas (UC-03 a UC-06) | UC-03, UC-04, UC-05, UC-06 | US-003, US-004, US-005, US-006, US-007 | ✅ Completo |
| 2b | Gestión de Leads y Consultas (UC-07 a UC-10) | UC-07, UC-08, UC-09, UC-10 | US-008, US-009, US-010, US-011, US-012, US-013 | ✅ Completo |
| 3 | Pre-reserva y Presupuestos | UC-14, UC-15, UC-16 | US-014, US-015, US-016 | ✅ Completo |
| 4 | Gestión de Cola de Espera | UC-11, UC-12, UC-13 | US-017, US-018, US-019, US-020 | ✅ Completo |
| 5 | Confirmación de Reserva | UC-17, UC-18, UC-19 | US-021, US-022, US-023, US-024 | ✅ Completo |
| 6 | Sub-procesos Paralelos | UC-20, UC-21, UC-22 | US-025, US-026, US-027, US-028, US-029, US-030 | ✅ Completo |
| 7 | Ejecución del Evento | UC-23, UC-24, UC-25 | US-031, US-032, US-033, US-034 | ✅ Completo |
| 8 | Post-evento | UC-26, UC-27, UC-28 | US-035, US-036, US-037, US-038 | ✅ Completo |
| 9 | Calendario y Disponibilidad | UC-29, UC-30, UC-31 | US-039, US-040, US-041 | ✅ Completo |
| 10 | Histórico | UC-32, UC-33 | US-042, US-043 | ✅ Completo |
| 11 | Dashboard | UC-34 | US-044 | ✅ Completo |
| 12 | Comunicaciones | UC-35, UC-36 | US-045, US-046 | ✅ Completo |

**UC cubiertos: 36/36** ✅
+**Historias que pasan la puerta INVEST: 48/48** ✅ *(incluye US-000 y US-000A — Technical Foundation Stories)*

---

## Matriz por área

### Área 0: Infraestructura / Fundación técnica

| UC | Historia(s) US | Área | Prioridad | Dolor | Alcance | INVEST | Cubierto |
|----|----------------|------|-----------|-------|---------|--------|----------|
| *(ninguno)* | [US-000](US-000-setup-scaffolding.md) — Setup y Scaffolding del Monorepo | Infraestructura | Crítica | D1, D4 | ✅ Implementado | OK (excepción S declarada: Technical Foundation Story, partición opcional en US-000a/b/c/d documentada) | ✅ |

**Verificación del lote:**
- UC cubiertos en este lote: **N/A** (historia de infraestructura técnica, prerequisito de todos los UC)
- Historias que pasan la puerta INVEST: **1/1** (excepción S justificada como Technical Foundation Story)
- US sin UC de origen (invenciones): **ninguna** — US-000 está explícitamente solicitada y es prerequisito documentado en `architecture.md §2`

---

### Área 0b: Infraestructura / App Shell
 
| UC | Historia(s) US | Área | Prioridad | Dolor | Alcance | INVEST | Cubierto |
|----|----------------|------|-----------|-------|---------|--------|----------|
| *(ninguno)* | [US-000A](US-000A-app-shell-esqueleto-navegacion.md) — App Shell y Esqueleto de Navegación | Infraestructura | Crítica | D2 | ✅ Implementado | OK (excepción I declarada: depende de US-000; independiente de toda historia de dominio) | ✅ |
 
**Verificación del lote:**
- UC cubiertos en este lote: **N/A** (infraestructura de UI, prerequisito de toda pantalla autenticada)
- Historias que pasan la puerta INVEST: **1/1** (excepción I justificada: dependencia de scaffolding)
- US sin UC de origen (invenciones): **ninguna** — US-000A es prerequisito de UI documentado en `architecture.md §2` (SPA Vite+React+React Router) y en los diseños Figma (shell compartido por todas las pantallas autenticadas)
- Re-cableo: **US-001 (login) pasa a depender de US-000A** (se monta sobre el routing del shell y redirige a él tras autenticar). El layout de autenticación del login es propio de US-001 y no usa este shell.

---

### Área 1: Autenticación

| UC | Historia(s) US | Área | Prioridad | Dolor | Alcance | INVEST | Cubierto |
|----|----------------|------|-----------|-------|---------|--------|----------|
| UC-01 | [US-001](US-001-iniciar-sesion.md) — Iniciar Sesión | Autenticación | Alta | D1 | ✅ Implementado | OK (excepción I declarada: depende de US-000A — el login se monta sobre el routing del shell y redirige a él tras autenticar; usa su propio layout de auth) | ✅ |
| UC-02 | [US-002](US-002-cerrar-sesion.md) — Cerrar Sesión | Autenticación | Alta | D1 | ✅ Implementado | OK (excepción I declarada: dependencia lógica de US-001) | ✅ |

**Verificación del lote:**
- UC cubiertos en este lote: **2/2** (UC-01, UC-02 — área Autenticación completa)
- Historias que pasan la puerta INVEST: **2/2**
- US sin UC de origen (invenciones): **ninguna**
- UC sin cobertura en este lote: **ninguno**

---

### Área 2: Gestión de Leads y Consultas (UC-03 a UC-06)

| UC | Historia(s) US | Área | Prioridad | Dolor | Alcance | INVEST | Cubierto |
|----|----------------|------|-----------|-------|---------|--------|----------|
| UC-03 | [US-003](US-003-alta-consulta-exploratoria.md) — Alta de consulta exploratoria sin fecha (→ 2.a) | Gestión de Leads y Consultas | Crítica | D1, D2, D9 | ✅ Implementado | OK (excepción I declarada: dependencia de US-001) | ✅ |
| UC-03 | [US-004](US-004-alta-consulta-con-fecha.md) — Alta de consulta con fecha disponible (→ 2.b + bloqueo atómico) | Gestión de Leads y Consultas | Crítica | D1, D2, D4, D9, D13 | ✅ Implementado | OK (excepción I declarada: edge case 2.d depende de historias de cola UC-11/12/13) | ✅ |
| UC-04 | [US-005](US-005-transicion-exploratoria-a-con-fecha.md) — Transicionar consulta exploratoria a consulta con fecha (2.a → 2.b) | Gestión de Leads y Consultas | Alta | D2, D3, D4 | ✅ Implementado | OK (excepción I declarada: depende de US-004 para lógica de bloqueo; gap de email en UC-04 paso 8 documentado) | ✅ |
| UC-05 | [US-006](US-006-extender-plazo-bloqueo.md) — Extender plazo de bloqueo de fecha | Gestión de Leads y Consultas | Media | D4, D11 | ✅ Implementado | OK (excepción I declarada: depende de US-004/US-005) | ✅ |
| UC-06 | [US-007](US-007-transicion-pendiente-invitados.md) — Transicionar consulta a pendiente de número de invitados (2.b → 2.c) | Gestión de Leads y Consultas | Alta | D2, D3, D4, D13 | ✅ Implementado | OK (excepción I declarada: depende de US-004/US-005; gaps de email en UC-06 documentados) | ✅ |

**Verificación del lote:**
- UC cubiertos en este lote: **4/4** (UC-03, UC-04, UC-05, UC-06)
- Historias generadas: **5** (UC-03 dividido en US-003 + US-004 por INVEST-S: bloqueo atómico es zona crítica separada del flujo sin fecha)
- Historias que pasan la puerta INVEST: **5/5**
- US sin UC de origen (invenciones): **ninguna**
- UC sin cobertura en este lote: **ninguno**

**Gaps de spec detectados en este lote (a confirmar con product owner):**
1. **UC-04 paso 8**: describe un email de confirmación de bloqueo provisional al transicionar 2.a → 2.b, pero §9.3 no asigna código E a esta comunicación. No referenciado como email en US-005 (cumple regla del prompt). Pendiente de catalogar
2. **UC-06 paso 7**: describe un email al cliente solicitando nº de invitados al transicionar a 2.c, pero §9.3 no asigna código E. No referenciado como email en US-007. Pendiente de catalogar

---

### Área 2b: Gestión de Leads y Consultas (UC-07 a UC-10)

| UC | Historia(s) US | Área | Prioridad | Dolor | Alcance | INVEST | Cubierto |
|----|----------------|------|-----------|-------|---------|--------|----------|
| UC-07 | [US-008](US-008-programar-visita-espacio.md) — Programar visita al espacio (→ 2.v) | Gestión de Leads y Consultas | Alta | D2, D3, D9 | ✅ Implementado | OK (excepción I declarada: depende de RESERVA en 2.a/2.b/2.c — US-004/US-005/US-007) | ✅ |
| UC-08 | [US-009](US-009-resultado-visita-cliente-interesado.md) — Resultado de visita: cliente interesado (2.v → 2.b) | Gestión de Leads y Consultas | Alta | D2, D3, D9 | ✅ Implementado | OK (excepción I declarada: depende de US-008, RESERVA en 2.v) | ✅ |
| UC-08 | [US-010](US-010-resultado-visita-reserva-inmediata.md) — Resultado de visita: reserva inmediata (2.v → pre_reserva) | Gestión de Leads y Consultas | Alta | D2, D3, D6 | ✅ Implementado | OK (excepción I declarada: depende de US-008, datos completos de CLIENTE; generación de presupuesto delegada a UC-14) | ✅ |
| UC-08 | [US-011](US-011-resultado-visita-cliente-descarta.md) — Resultado de visita: cliente descarta (2.v → 2.z) | Gestión de Leads y Consultas | Alta | D2, D4, D13 | ✅ Implementado | OK (excepción I declarada: depende de US-008; promoción de cola delegada a mecánica UC-12/A15) | ✅ |
| UC-09 | [US-012](US-012-expirar-consulta-automaticamente.md) — Expirar consulta automáticamente por TTL agotado | Gestión de Leads y Consultas | Crítica | D4, D1, D13 | ✅ Implementado | OK (excepción I declarada: depende de reservas con TTL; cola delega a UC-12. Excepción N declarada: comportamiento fijado por spec — TTL agotado → terminal es regla dura) | ✅ |
| UC-10 | [US-013](US-013-marcar-consulta-descartada-por-cliente.md) — Marcar consulta como descartada por cliente (→ 2.z) | Gestión de Leads y Consultas | Media | D2, D3, D4 | ✅ Implementado | OK | ✅ |

**Verificación del lote:**
- UC cubiertos en este lote: **4/4** (UC-07, UC-08, UC-09, UC-10 — área Gestión de Leads y Consultas completa)
- Historias generadas: **6** (UC-08 dividido en US-009 + US-010 + US-011 por INVEST-S: tres resultados de visita con transiciones de estado y actores distintos)
- Historias que pasan la puerta INVEST: **6/6**
- US sin UC de origen (invenciones): **ninguna**
- UC sin cobertura en este lote: **ninguno**

**Gaps de spec detectados en este lote (a confirmar con product owner):**
1. **UC-09 paso 6**: "El sistema envía email al cliente notificando expiración" — este email no tiene código E asignado en §9.3. Confirmado como 📐 Solo diseñado en MVP. No referenciado en US-012 (cumple regla del prompt)
2. **A21b** (día +7 desde solicitud sin programar visita → expiración): esta automatización cubre la expiración cuando el gestor acepta la solicitud de visita pero nunca programa la fecha en el sistema. Se trata en US-012 como variante del mecanismo de expiración (ttl_expiracion < now en sub_estado '2v'). Sin brecha de cobertura
3. **UC-08 FA-03** (visita no realizada, gestor reprograma o deja expirar): cubierto en US-009 como edge case de FA-03 parcial (reprogramar → US-008; dejar expirar → US-012). No requiere historia separada
3. **UC-06 / A16 emails de cola**: los emails a los clientes en 2.d notificando el vaciado son 📐 Solo diseñado. La mecánica (2.d → 2.y) sí está implementada en US-007

---

### Área 3: Pre-reserva y Presupuestos (UC-14 a UC-16)

| UC | Historia(s) US | Área | Prioridad | Dolor | Alcance | INVEST | Cubierto |
|----|----------------|------|-----------|-------|---------|--------|----------|
| UC-14 | [US-014](US-014-generar-presupuesto-activar-prereserva.md) — Generar presupuesto y activar pre-reserva (consulta → pre_reserva + bloqueo 7d + E2) | Pre-reserva y Presupuestos | Crítica | D8, D3, D2, D4 | ✅ Implementado | OK (excepción I declarada: depende de RESERVA en {2.a, 2.b, 2.c, 2.v} — US-003/004/005/007/008, y del motor UC-16/US-016; excepción S declarada: toca tarifa delegada, estado machine, lock upgrade y vaciado de cola — acción atómica observable para el gestor) | ✅ |
| UC-15 | [US-015](US-015-editar-reenviar-presupuesto-prereserva.md) — Editar y reenviar presupuesto en pre-reserva | Pre-reserva y Presupuestos | Media | D8, D2 | ✅ Implementado | OK (excepción I declarada: depende de RESERVA en pre_reserva — US-014 y PRESUPUESTO existente) | ✅ |
| UC-16 | [US-016](US-016-motor-calculo-tarifa.md) — Motor de cálculo de tarifa (Sistema: fecha × duración × invitados → precio) | Pre-reserva y Presupuestos | Crítica | D8, D9 | ✅ Implementado | OK (independiente — motor puro de lectura sin dependencias de estado) | ✅ |

**Verificación del lote:**
- UC cubiertos en este lote: **3/3** (UC-14, UC-15, UC-16 — área Pre-reserva y Presupuestos completa)
- Historias generadas: **3** (un UC = una historia en los tres casos; UC-14 mantiene la acción atómica del gestor sin partir artificialmente)
- Historias que pasan la puerta INVEST: **3/3**
- US sin UC de origen (invenciones): **ninguna**
- UC sin cobertura en este lote: **ninguno**

**Gaps de spec detectados en este lote (a confirmar con product owner):**
1. **UC-15 email de reenvío**: §9.3 define E2 con trigger "Gestor activa pre-reserva (transición a `pre_reserva`)". UC-15 (editar y reenviar presupuesto estando ya en pre_reserva) no tiene asignado un código E propio. En US-015 se referencia E2 como template reutilizado para el reenvío manual; pendiente de confirmar si debe tener código propio o reutilizar E2

---

### Área 4: Gestión de Cola de Espera (UC-11 a UC-13)

| UC | Historia(s) US | Área | Prioridad | Dolor | Alcance | INVEST | Cubierto |
|----|----------------|------|-----------|-------|---------|--------|----------|
| UC-11 | [US-017](US-017-visualizar-cola-espera.md) — Visualizar Cola de Espera de una Fecha | Gestión de Cola de Espera | Alta | D2, D4 | ✅ Implementado | OK (excepción I declarada: depende de US-004/007/008 para que existan datos; visualización autocontenida) | ✅ |
| UC-12 | [US-018](US-018-promocion-automatica-cola.md) — Promoción Automática de la Primera Consulta en Cola (Sistema, trigger TTL) | Gestión de Cola de Espera | Crítica | D4, D13 | ✅ Implementado | OK (excepción I declarada: depende de US-012 como trigger; excepción N declarada: FIFO y atomicidad fijados por spec) | ✅ |
| UC-12 | [US-019](US-019-promocion-manual-cola.md) — Promoción Manual de Consulta en Cola por el Gestor | Gestión de Cola de Espera | Crítica | D2, D4 | ✅ Implementado | OK (excepción I declarada: depende de US-017 como UI y US-004 para bloqueo; excepción N declarada: atomicidad y expiración forzosa fijadas por spec) | ✅ |
| UC-13 | [US-020](US-020-salir-cola-voluntariamente.md) — Salir Voluntariamente de la Cola de Espera | Gestión de Cola de Espera | Media | D2, D3, D4 | ✅ Implementado | OK (excepción I declarada: depende de US-017 como UI y US-004 para que exista cola) | ✅ |

**Verificación del lote:**
- UC cubiertos en este lote: **3/3** (UC-11, UC-12, UC-13 — área Gestión de Cola de Espera completa)
- Historias generadas: **4** (UC-12 dividido en US-018 + US-019 por INVEST-S: actor Sistema con trigger TTL vs. actor Gestor con acción UI son historias separables; además, US-018 siempre promueve la posición 1 mientras US-019 permite cualquier posición)
- Historias que pasan la puerta INVEST: **4/4**
- US sin UC de origen (invenciones): **ninguna**
- UC sin cobertura en este lote: **ninguno**

**Gaps de spec detectados en este lote (a confirmar con product owner):**
1. **Email de promoción al cliente promovido** (UC-12 paso 8: "¡La fecha está disponible!"): confirmado como `📐 Solo diseñado`. No referenciado en US-018 ni US-019. La mecánica de promoción sí está implementada.
2. **Notificación al cliente de salida de cola** (UC-13 paso 6): confirmado como `📐 Solo diseñado`. No referenciado en US-020.
3. **Emails de vaciado de cola** (cuando la bloqueante avanza a `2.c` o `pre_reserva` y las consultas en cola pasan a `2.y`): ya confirmado como `📐` en el lote 2a. La mecánica de vaciado (2.d → 2.y) sí está en scope en US-007 y US-014.

---

---

### Área 5: Confirmación de Reserva

| UC | Historia(s) US | Área | Prioridad | Dolor | Alcance | INVEST | Cubierto |
|----|----------------|------|-----------|-------|---------|--------|----------|
| UC-17 | [US-021](US-021-confirmar-pago-senal-activar-reserva.md) — Confirmar pago de señal y activar reserva confirmada | Confirmación de Reserva | Crítica | D1, D3, D4 | ✅ Implementado | OK (excepción I declarada: depende de US-014 para `pre_reserva`; depende de US-022 y US-023 para E3. Excepción S declarada: bloqueo firme + transición + sub-procesos son una única operación atómica) | ✅ |
| UC-18 | [US-022](US-022-generar-factura-senal.md) — Generar factura de señal al confirmar reserva | Confirmación de Reserva | Crítica | D1, D6 | ✅ Implementado | OK (excepción I declarada: depende de US-021 — trigger es `reserva_confirmada`) | ✅ |
| UC-19 | [US-023](US-023-enviar-condiciones-particulares.md) — Generar y enviar condiciones particulares al cliente (E3) | Confirmación de Reserva | Alta | D1, D3 | ✅ Implementado | OK (excepción I declarada: depende de US-021 y US-022 — E3 requiere factura aprobada y reserva confirmada) | ✅ |
| UC-19 | [US-024](US-024-registrar-firma-condiciones-particulares.md) — Registrar firma de condiciones particulares | Confirmación de Reserva | Alta | D1, D3 | ✅ Implementado | OK (excepción I declarada: depende de US-023 — `cond_part_enviadas_fecha` no nulo obligatorio) | ✅ |

**Verificación del lote:**
- UC cubiertos en este lote: **3/3** (UC-17, UC-18, UC-19 — área Confirmación de Reserva completa)
- Historias generadas: **4** (UC-19 dividido en US-023 + US-024 por INVEST-S: generación/envío del documento y registro de firma son responsabilidades separadas con actores distintos — Sistema vs Gestor)
- Historias que pasan la puerta INVEST: **4/4**
- US sin UC de origen (invenciones): **ninguna**
- UC sin cobertura en este lote: **ninguno**

**Gaps de spec detectados en este lote:**
1. **E3 — contenido "próximos hitos"**: UC-17 paso 13 describe que E3 incluye "próximos hitos" además de la factura y las condiciones particulares. Este contenido informativo está cubierto implícitamente en US-023 (cuerpo del email) pero no existe un campo estructurado en `COMUNICACION` para los hitos. No es una entidad del er-diagram. Se asume que los hitos se incluyen en el campo `cuerpo` de `COMUNICACION`. Sin gap de spec material.
2. **UC-17 "checklist pre-evento"** (paso 11): UC-17 describe la generación de un "checklist pre-evento". Este checklist corresponde al sub-proceso de pre-evento (UC-20, lote futuro). En US-021 se crea la `FICHA_OPERATIVA` vacía, que es la entidad que soporta el checklist. El checklist en sí se gestiona en UC-20 (no cubierto en este lote).

---

### Área 6: Sub-procesos Paralelos (UC-20 a UC-22)

| UC | Historia(s) US | Área | Prioridad | Dolor | Alcance | INVEST | Cubierto |
|----|----------------|------|-----------|-------|---------|--------|----------|
| UC-20 | [US-025](US-025-cumplimentar-ficha-operativa-evento.md) — Cumplimentar y cerrar la ficha operativa del evento | Sub-procesos Paralelos | Alta | D10, D9, D1 | ✅ Implementado | OK (excepción I declarada: depende de US-021 — `FICHA_OPERATIVA` creada en `reserva_confirmada`) | ✅ |
| UC-20 | [US-026](US-026-cierre-automatico-ficha-operativa-t1d.md) — Sistema cierra la ficha operativa automáticamente en T-1d (A10) | Sub-procesos Paralelos | Alta | D10, D11 | ✅ Implementado | OK (excepción I declarada: depende de US-021 y US-025. Excepción N declarada: trigger T-1d es regla dura de la spec — A10) | ✅ |
| UC-21 | [US-027](US-027-generar-borradores-liquidacion-fianza.md) — Sistema genera factura de liquidación y recibo de fianza en borrador (A7) | Sub-procesos Paralelos | Crítica | D6, D8, D9 | ✅ Implementado | OK (excepción I declarada: depende de US-021 — `reserva_confirmada`, `importe_liquidacion` calculado. Excepción N declarada: el 60% y el IVA 21% son reglas duras) | ✅ |
| UC-21, UC-22 | [US-028](US-028-enviar-factura-liquidacion-cliente.md) — Gestor aprueba y envía factura de liquidación al cliente (E4; efecto: `fianza_status = recibo_enviado`) | Sub-procesos Paralelos | Crítica | D6, D9, D1 | ✅ Implementado | OK (excepción I declarada: depende de US-027 — borradores generados. Atomicidad email↔estado declarada) | ✅ |
| UC-21 | [US-029](US-029-registrar-cobro-liquidacion.md) — Gestor registra el cobro de la liquidación (`liquidacion_status → cobrada`) | Sub-procesos Paralelos | Crítica | D6, D1, D11 | ✅ Implementado | OK (excepción I declarada: depende de US-028 — `liquidacion_status = facturada`) | ✅ |
| UC-22 | [US-030](US-030-registrar-cobro-fianza.md) — Gestor registra el cobro de la fianza (`fianza_status → cobrada`) | Sub-procesos Paralelos | Alta | D6, D1, D11 | ✅ Implementado | OK (excepción I declarada: depende de US-028 — `fianza_status = recibo_enviado`. Excepción N declarada: FA-01 política "Negociable" hardcoded) | ✅ |

**Verificación del lote:**
- UC cubiertos en este lote: **3/3** (UC-20, UC-21, UC-22 — área Sub-procesos Paralelos completa)
- Historias generadas: **6**
  - UC-20 → 2 historias: US-025 (Gestor, acción manual) + US-026 (Sistema, cron T-1d) — split por INVEST-S (actor distinto, trigger distinto)
  - UC-21 → 3 historias: US-027 (Sistema genera borradores) + US-028 (Gestor envía E4) + US-029 (Gestor registra cobro) — split por INVEST-S (tres momentos distintos en el pipeline de cobro)
  - UC-22 → 1 historia: US-030 (Gestor registra cobro de fianza) — el envío del recibo de fianza está cubierto como efecto de US-028 (E4 incluye recibo) y como edge case de envío separado
- Historias que pasan la puerta INVEST: **6/6**
- US sin UC de origen (invenciones): **ninguna**
- UC sin cobertura en este lote: **ninguno**

**Gaps de spec detectados en este lote (a confirmar con product owner):**
1. **A25 (T-3d fianza → recordatorio cliente) y A26 (T-1d fianza → alerta gestor)**: ambas automaciones son 📐 (lista negra: recordatorios automáticos extendidos y recordatorios de cobro). No referenciadas en US-029 ni US-030. Sin gap de MVP.
2. **FA-01 de UC-21 (T-1d sin cobro → alerta crítica al gestor)**: la alerta al gestor es parte de la automatización de cobro y queda en 📐. Declarado en US-028 y US-029.
3. **E4 bundle liquidación + fianza**: la spec define E4 como un único email con ambos documentos. US-028 cubre el happy path (envío conjunto). El envío separado del recibo de fianza se cubre como edge case en US-028. El campo `codigo_email` en `COMUNICACION` para el envío separado queda sin código E asignado — pendiente de confirmar si se trata como `manual` o se asigna código propio.
4. **`TENANT_SETTINGS.fianza_default_eur = 0`**: si el tenant no cobra fianza, el sub-proceso de fianza queda inactivo. Cubierto como edge case en US-027. Sin gap material.

---

---

### Área 7: Ejecución del Evento (UC-23 a UC-25)

| UC | Historia(s) US | Área | Prioridad | Dolor | Alcance | INVEST | Cubierto |
|----|----------------|------|-----------|-------|---------|--------|----------|
| UC-23 | [US-031](US-031-inicio-automatico-evento.md) — Sistema transiciona reserva a evento en curso cuando se cumplen las precondiciones | Ejecución del Evento | Alta | D9, D10, D2 | ✅ Implementado | OK (excepción I declarada: depende de US-025/026, US-029, US-030. Excepción N declarada: las tres precondiciones y el trigger 00:00 son reglas duras de la spec) | ✅ |
| UC-23 | [US-032](US-032-forzar-inicio-evento.md) — Gestor fuerza el inicio del evento cuando alguna precondición está incumplida | Ejecución del Evento | Alta | D2 | ✅ Implementado | OK (excepción I declarada: FA-01 de UC-23, depende de US-031 como flujo alternativo del mismo estado) | ✅ |
| UC-24 | [US-033](US-033-capturar-documentacion-evento.md) — Gestor/Equipo captura la documentación obligatoria durante el evento | Ejecución del Evento | Alta | D10, D9, D1 | ✅ Implementado | OK (excepción I declarada: depende de US-031 o US-032 para `evento_en_curso`) | ✅ |
| UC-25 | [US-034](US-034-finalizar-evento.md) — Gestor finaliza el evento y activa el proceso de post-evento | Ejecución del Evento | Alta | D9, D6, D1 | ✅ Implementado | OK (excepción I declarada: depende de US-031 o US-032 para `evento_en_curso`. Excepción N declarada: A11 factura complementaria y NPS automática son 📐, declarados en Notas de alcance) | ✅ |

**Verificación del lote:**
- UC cubiertos en este lote: **3/3** (UC-23, UC-24, UC-25 — área Ejecución del Evento completa)
- Historias generadas: **4** (UC-23 dividido en US-031 + US-032 por INVEST-S: actor Sistema con trigger cron 00:00 vs. actor Gestor con override manual son flujos con actores y triggers distintos; además la trazabilidad de auditoría del forzado es diferente)
- Historias que pasan la puerta INVEST: **4/4**
- US sin UC de origen (invenciones): **ninguna**
- UC sin cobertura en este lote: **ninguno**

**Gaps de spec detectados en este lote (a confirmar con product owner):**
1. **UC-23 paso 5 — Briefing operativo al equipo en T-0**: UC-23 describe el envío del briefing al equipo al iniciar el evento. La spec §9.3 indica explícitamente que este email NO está implementado en MVP TFM (párrafo final de §9.3). No hay código E asignado para el briefing al equipo. Declarado en Notas de alcance de US-031. Sin gap de MVP.
2. **A9 (T-3d briefing)**: también 📐 (lista negra: recordatorios automáticos extendidos). No referenciado en US-031. Sin gap de MVP.
3. **A11 factura complementaria**: la generación de factura complementaria post-evento es 📐 (lista negra explícita). Declarado en Notas de alcance de US-034. Si hay `RESERVA_EXTRA.factura_id IS NULL` al finalizar el evento, quedan pendientes.
4. **NPS automática a T+3d**: el disparo automático del email de NPS es parte de los recordatorios automáticos extendidos (📐). En MVP, la NPS queda en estado "programada" en US-034 pero no se envía automáticamente. Declarado en Notas de alcance de US-034.
5. **A23 y A24 (recordatorios IBAN T+3d y T+7d)**: ambos 📐 (lista negra). No referenciados. Sin gap de MVP.

---

---

### Área 8: Post-evento (UC-26 a UC-28)

| UC | Historia(s) US | Área | Prioridad | Dolor | Alcance | INVEST | Cubierto |
|----|----------------|------|-----------|-------|---------|--------|----------|
| UC-26 | [US-034](US-034-finalizar-evento.md) (E5 enviado al entrar en `post_evento`) + [US-035](US-035-registrar-iban-cliente-devolucion-fianza.md) — Registrar IBAN del cliente + E8 | Post-evento | Alta | D6, D9 | ✅ Implementado | OK (excepción I declarada en US-035: depende de US-034. Recordatorios A23/A24 son 📐, declarados en Notas de alcance de US-035) | ✅ |
| UC-27 | [US-035](US-035-registrar-iban-cliente-devolucion-fianza.md) (pasos 1–3: IBAN + E8) + [US-036](US-036-registrar-devolucion-fianza.md) — Registrar devolución de fianza (completa o parcial) | Post-evento | Alta | D6, D1 | ✅ Implementado | OK (excepción I declarada: US-035 depende de US-034; US-036 depende de US-035. FA-02 IBAN erróneo cubierto como flujo en US-035 FA-02 + US-036 FA-02) | ✅ |
| UC-28 | [US-037](US-037-archivado-automatico-reserva-completada.md) — Archivado automático (Sistema, A12 T+7d) + [US-038](US-038-archivado-manual-reserva-completada.md) — Archivado manual (Gestor) | Post-evento | Media | D5, D9, D1 | ✅ Implementado | OK (excepción I declarada: ambas dependen de US-034 y US-036. Excepción N declarada para US-037: trigger T+7d y condición de fianza fijados por spec — A12, edge case 27) | ✅ |

**Verificación del lote:**
- UC cubiertos en este lote: **3/3** (UC-26, UC-27, UC-28 — área Post-evento completa)
- Historias generadas: **4**
  - UC-26 → cubierto por US-034 (E5 ya generado al entrar en `post_evento`) + US-035 (registro IBAN + E8). No se genera historia nueva para la parte de E5, ya emitida en lote 7.
  - UC-27 → 2 historias: US-035 (registro de IBAN, pasos 1–3) + US-036 (devolución completa/parcial, pasos 4–8). Split por INVEST-S: colección de dato (IBAN → E8) y operación financiera (devolución + justificante) son acciones distintas con días de separación posible entre ellas.
  - UC-28 → 2 historias: US-037 (Sistema, cron A12) + US-038 (Gestor, acción manual). Split por INVEST-S: actor distinto y trigger distinto; patrón establecido en lotes anteriores (US-031/US-032, US-025/US-026).
- Historias que pasan la puerta INVEST: **4/4**
- US sin UC de origen (invenciones): **ninguna**
- UC sin cobertura en este lote: **ninguno**

**Gaps de spec detectados en este lote (a confirmar con product owner):**
1. **UC-26 recordatorios automáticos A23 (T+3d sin IBAN) y A24 (T+7d segundo recordatorio)**: ambos marcados como `📐 Solo diseñado`. No implementados en MVP. Declarados en Notas de alcance de US-035.
2. **UC-27 — notificación al cliente de la devolución efectiva**: §9.3 no asigna código E para comunicar al cliente que la transferencia de devolución de fianza se ha realizado. El gestor puede enviar email manual desde la ficha. Declarado en Notas de alcance de US-036.
3. **UC-28 — T+5d propuesta de cierre administrativo al gestor**: mencionada en spec §8 de post_evento. Esta alerta proactiva previa al T+7d es `📐 Solo diseñado`. El archivado automático a T+7d (A12) sí es `✅`. Declarado en Notas de alcance de US-037.
4. **Formulario web autónomo del cliente para aportar IBAN**: `📐`. En MVP el gestor introduce el IBAN manualmente. Declarado en Notas de alcance de US-035.

---

---

### Área 9: Calendario y Disponibilidad (UC-29 a UC-31)

| UC | Historia(s) US | Área | Prioridad | Dolor | Alcance | INVEST | Cubierto |
|----|----------------|------|-----------|-------|---------|--------|----------|
| UC-29 | [US-039](US-039-consultar-calendario.md) — Visualizar el Calendario de Disponibilidad | Calendario y Disponibilidad | Crítica | D2, D4 | ✅ Implementado | OK (independiente — lectura pura sobre `RESERVA` y `FECHA_BLOQUEADA`; no impone orden de implementación) | ✅ |
| UC-30 | [US-040](US-040-bloquear-fecha-atomicamente.md) — Bloquear Fecha Atómicamente (Sistema) | Calendario y Disponibilidad | Crítica | D4 | ✅ Implementado | OK (excepción I declarada: operación fundacional invocada por US-004/007/014/021; puede implementarse en primer lugar. Excepción N declarada: `UNIQUE(tenant_id, fecha)` + `SELECT … FOR UPDATE` son reglas duras de la spec) | ✅ |
| UC-31 | [US-041](US-041-liberar-fecha.md) — Liberar Bloqueo de Fecha (Sistema) | Calendario y Disponibilidad | Crítica | D4, D13 | ✅ Implementado | OK (excepción I declarada: depende de US-040 para que exista el bloqueo; dispara US-018 como consecuencia. Excepción N declarada: atomicidad del DELETE y disparo de promoción son reglas duras) | ✅ |

**Verificación del lote:**
- UC cubiertos en este lote: **3/3** (UC-29, UC-30, UC-31 — área Calendario y Disponibilidad completa)
- Historias generadas: **3** (una por UC; ninguno justifica partición por INVEST-S: UC-29 es lectura pura, UC-30 y UC-31 son operaciones atómicas únicas con variantes de parámetro)
- Historias que pasan la puerta INVEST: **3/3**
- US sin UC de origen (invenciones): **ninguna**
- UC sin cobertura en este lote: **ninguno**

**Gaps de spec detectados en este lote (a confirmar con product owner):**
1. **Código de colores UC-29 vs §11.3 SlotifyGeneralSpecs**: UC-29 flujo básico menciona "Gris: consulta activa" y el texto omitido incluye los demás estados. SlotifyGeneralSpecs §11.3 define: gris=consulta, ámbar=pre-reserva, verde=confirmada, azul=histórica, rojo=cancelada, violeta=en cola. US-039 usa la tabla §11.3 como fuente canónica. Sin conflicto material; documentado en Notas de alcance.
2. **`evento_en_curso` y `post_evento` sin color propio**: la tabla §11.3 no asigna colores distintos a estos estados. US-039 los agrupa como verde (continuidad visual de `reserva_confirmada`). El PO puede diferenciarlos con chips de detalle sin cambio de arquitectura.
3. **Email de promoción de cola tras liberación (US-041 → US-018)**: el email al cliente promovido al liberar la fecha bloqueante es `📐 Solo diseñado`. La mecánica de promoción (US-018) sí está en scope. Declarado en Notas de alcance de US-041.
4. **UC-30 FA-01 "ofrecer cola si 2.b"**: US-040 gestiona solo el rechazo atómico (UNIQUE violation). La oferta de cola la gestiona el flujo invocante (US-004). Sin gap de MVP; distribución de responsabilidades declarada en Notas de alcance de US-040.

---

### Área 10: Histórico (UC-32 a UC-33)

| UC | Historia(s) US | Área | Prioridad | Dolor | Alcance | INVEST | Cubierto |
|----|----------------|------|-----------|-------|---------|--------|----------|
| UC-32 | [US-042](US-042-buscar-en-historico.md) — Buscar y Filtrar en el Histórico de Reservas | Histórico | Alta | D5, D1, D9 | ✅ Implementado | OK (excepción I declarada: depende de datos en `reserva_completada` generados por US-037/US-038; vista de lectura autocontenida, desarrollable en paralelo con datos de prueba) | ✅ |
| UC-33 | [US-043](US-043-exportar-reservas-csv.md) — Exportar Reservas a CSV | Histórico | Media | D5, D1, D9 | ✅ Implementado | OK (excepción I declarada: contexto habitual implica filtros de US-042, pero la operación es independiente técnicamente — puede lanzarse desde histórico o pipeline) | ✅ |

**Verificación del lote:**
- UC cubiertos en este lote: **2/2** (UC-32, UC-33 — área Histórico completa)
- Historias generadas: **2** (una por UC; ninguno justifica partición por INVEST-S: UC-32 es búsqueda/lectura pura, UC-33 es una única operación de serialización)
- Historias que pasan la puerta INVEST: **2/2**
- US sin UC de origen (invenciones): **ninguna**
- UC sin cobertura en este lote: **ninguno**

**Gaps de spec detectados en este lote (a confirmar con product owner):**
1. **Columnas del CSV (UC-33 paso 4)**: el UC indica "todos los atributos de la reserva". Se han excluido por seguridad `CLIENTE.iban_devolucion`, `TENANT.iban` y campos de infraestructura. Si el tenant necesita el IBAN para conciliación bancaria, se puede añadir como opción opt-in de configuración sin cambio de arquitectura. Pendiente de confirmar lista definitiva de columnas.
2. **Límite de filas exportables**: la spec no define un techo. US-043 asume generación síncrona para el volumen del MVP (1 tenant, < cientos de registros). Si en producción multitenante el volumen creciera, se migraría a generación asíncrona sin cambio de historia.
3. **Exportación desde Pipeline (reservas activas)**: UC-33 paso 1 menciona explícitamente que el gestor puede exportar desde el histórico **o** desde el pipeline. US-043 cubre ambas superficies como un único comportamiento del botón "Exportar CSV" con el conjunto filtrado activo.

---

## UC pendientes de cobertura

Ninguno. Todos los 36 UC del MVP están cubiertos.

---

### Área 11: Dashboard (UC-34)

| UC | Historia(s) US | Área | Prioridad | Dolor | Alcance | INVEST | Cubierto |
|----|----------------|------|-----------|-------|---------|--------|----------|
| UC-34 | [US-044](US-044-visualizar-dashboard-operativo.md) — Visualizar Dashboard Operativo | Dashboard | Alta | D7, D2, D11 | ✅ Implementado | OK (excepción S declarada: 7 widgets co-ubicados en la misma pantalla read-only; ninguno es zona crítica, partir por widget no aporta valor independiente) | ✅ |

**Verificación del lote:**
- UC cubiertos en este lote: **1/1** (UC-34 — área Dashboard completa)
- Historias generadas: **1** (una historia; no se justifica partición por INVEST-S: vista read-only sin mutaciones ni zonas críticas)
- Historias que pasan la puerta INVEST: **1/1**
- US sin UC de origen (invenciones): **ninguna**
- UC sin cobertura en este lote: **ninguno**

**Gaps de spec detectados en este lote (a confirmar con product owner):**
1. **Dashboard financiero + KPIs avanzados (§7.2)**: confirmado como `📐 Solo diseñado`. Los 15 widgets de §7.2 (ingresos, ocupación, ticket medio, ratio conversión, estacionalidad, etc.) no se incluyen en esta historia. Declarado en Notas de alcance de US-044.
2. **Filtro "clientes recurrentes" en §7.3**: `📐 Solo diseñado`. No implementado en MVP. Declarado en Notas de alcance de US-044.
3. **Umbral de "próximo a expirar" en widget "Pendientes"**: UC-34 no define el umbral de alerta (p. ej. TTL < 24 h vs < 48 h). US-044 usa 24 horas como valor por defecto razonable, configurable en `TENANT_SETTINGS` si el PO lo requiere. Pendiente de confirmar.
4. **Definición de "sub-proceso atrasado" en widget "Sub-procesos críticos"**: la spec no define el umbral exacto de "atrasado" (p. ej. ¿a partir de T-7d? ¿T-3d?). US-044 lo modela como "sub-proceso en estado no-final con fecha del evento próxima" y delega el umbral a configuración. Pendiente de confirmar con PO.

---

### Área 12: Comunicaciones (UC-35, UC-36)

| UC | Historia(s) US | Área | Prioridad | Dolor | Alcance | INVEST | Cubierto |
|----|----------------|------|-----------|-------|---------|--------|----------|
| UC-35 | [US-045](US-045-enviar-email-automatico.md) — Sistema envía email automático al detectar el trigger (E1–E8) | Comunicaciones | Crítica | D1, D3, D9 | ✅ Implementado | OK (excepción I declarada: triggers dependen de historias que activan cada transición de estado; mecanismo de envío autocontenido. Excepción S declarada: 8 emails comparten infraestructura idéntica; test parametrizado por `codigo_email` justifica agrupación) | ✅ |
| UC-36 | [US-046](US-046-revisar-enviar-email-borrador.md) — Gestor revisa y envía email borrador generado por el sistema | Comunicaciones | Alta | D1, D3 | ✅ Implementado | OK (excepción I declarada: depende de US-045 para la creación del borrador de E1; acción del gestor autocontenida) | ✅ |

**Verificación del lote:**
- UC cubiertos en este lote: **2/2** (UC-35, UC-36 — área Comunicaciones completa)
- Historias generadas: **2** (una por UC; UC-35 no se particiona por email ya que los 8 comparten infraestructura idéntica y el test es parametrizado; UC-36 es responsabilidad única de revisión/envío manual)
- Historias que pasan la puerta INVEST: **2/2**
- US sin UC de origen (invenciones): **ninguna**
- UC sin cobertura en este lote: **ninguno**

**Gaps de spec detectados en este lote (a confirmar con product owner):**
1. **Emails de notificación de cola (entrada, promoción, descarte)**: confirmados como `📐 Solo diseñado`. No se generan historias. La mecánica de cola (posicion_cola, consulta_bloqueante_id) sí está implementada en US-018/019/020.
2. **Recordatorios automáticos extendidos (T-15d, T-3d, T-1d, recordatorios de cobro A23/A24/A25/A26)**: confirmados como `📐 Solo diseñado`. No referenciados en US-045.
3. **Email de briefing operativo al equipo (UC-23 paso 5)**: no tiene código E asignado en §9.3 y no está implementado en MVP. Ya declarado en Notas de alcance de US-031.
4. **NPS automática a T+3d (UC-25 paso 7)**: `📐 Solo diseñado`. Ya declarado en Notas de alcance de US-034.
5. **Descarte de borrador → enum `estado = 'fallido'`**: UC-36 no define un estado "descartado" explícito. En US-046 se usa `estado = 'fallido'` para el descarte intencional del gestor, con la causa en `AUDIT_LOG`. Pendiente de confirmar si el er-diagram debe extender el enum `COMUNICACION.estado` con un valor `'descartado'` para distinguirlo de un fallo técnico.

---

## Resumen final de cobertura

**UC cubiertos: 36/36** ✅  
**Historias emitidas: 46**  
**Historias que pasan la puerta INVEST: 46/46** ✅  
**US sin UC de origen (invenciones): 0** ✅  
**UC sin cobertura: 0** ✅

| Área | UC | Historias |
|------|----|-----------|
| Autenticación | UC-01–02 | US-001–002 |
| Gestión de Leads y Consultas | UC-03–10 | US-003–013 |
| Pre-reserva y Presupuestos | UC-14–16 | US-014–016 |
| Gestión de Cola de Espera | UC-11–13 | US-017–020 |
| Confirmación de Reserva | UC-17–19 | US-021–024 |
| Sub-procesos Paralelos | UC-20–22 | US-025–030 |
| Ejecución del Evento | UC-23–25 | US-031–034 |
| Post-evento | UC-26–28 | US-035–038 |
| Calendario y Disponibilidad | UC-29–31 | US-039–041 |
| Histórico | UC-32–33 | US-042–043 |
| Dashboard | UC-34 | US-044 |
| Comunicaciones | UC-35–36 | US-045–046 |
