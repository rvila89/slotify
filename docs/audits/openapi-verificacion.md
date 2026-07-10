# Informe de Auditoría del Contrato API — Slotify

> **Rol**: Auditoría de contrato (solo lectura). Este documento NO modifica ninguna fuente ni el contrato.
> **Artefacto auditado**: `docs/api-spec.yml` (OpenAPI 3.0). **Nota**: el repo no contiene un fichero `openapi.yaml`; el único contrato OpenAPI es `docs/api-spec.yml`, que se audita como tal.
> **Fuentes de verdad (solo lectura)**: `docs/er-diagram.md` · `user-stories/US-*.md` (+ `user-stories/_trazabilidad.md`) · `docs/architecture.md` §2.8 · `context/SlotifyGeneralSpecs.md`.
> **Fecha**: 04/06/2026

---

## Resumen de hallazgos

### Por severidad

| Severidad | Recuento |
|---|---|
| Bloqueante | 0 |
| Alta | 2 |
| Media | 8 |
| Baja | 10 |
| **Total** | **20** |

### Por tipo de comprobación

| Tipo | Comprobación | Hallazgos |
|---|---|---|
| 1 | Trazabilidad paths ↔ user stories | 9 |
| 2 | Schemas ↔ ER diagram | 4 |
| 3 | Auth ↔ architecture §2.8 | 1 |
| 4 | Conceptos ajenos (contaminación de plantilla) | 0 (LIMPIO) |
| 5 | Detalles inventados / NO ESPECIFICADO | 6 |

---

## Tipo 1 — Trazabilidad paths ↔ user stories

| ID | Sev. | Ubicación (api-spec.yml) | Evidencia en fuente | Hallazgo y recomendación |
|---|---|---|---|---|
| **F1-01** | **Alta** | `POST /reservas/{id}/transiciones` (schema `TransicionRequest`) y `PATCH /reservas/{id}` (schema `UpdateReservaRequest`) | US-005 líneas 32-33 ("la `fecha_evento` introducida debe ser ≥ hoy"; transición 2.a → 2.b inserta `FECHA_BLOQUEADA`) | **No existe ningún campo ni endpoint para asignar `fecha_evento` a una consulta existente.** `TransicionRequest` solo tiene `estadoDestino`/`subEstadoDestino`/`motivo`; `UpdateReservaRequest` no incluye `fechaEvento`. La transición 2.a→2.b (US-005) y la lógica de bloqueo asociada **no son expresables** con el contrato actual. Revisar: añadir `fechaEvento` a la transición o un endpoint dedicado de asignación de fecha. |
| **F1-02** | **Alta** | `POST /reservas/{id}/facturas`, `GET /reservas/{id}/facturas`, schema `Factura`/`EstadoFactura` | US-028 líneas 31-37 ("revisar el borrador… aprobarlo y enviarlo"; `FACTURA(liquidacion).estado = borrador → enviada`, número asignado, E4 disparado) | **No hay endpoint para aprobar/enviar una factura ni para transicionar su `estado`** (`borrador → enviada → cobrada`). El contrato solo crea facturas (`POST`). US-028 (aprobar y enviar liquidación, efecto cascada sobre `fianza_status`) queda **SIN ENDPOINT**. Revisar: añadir acción de aprobación/envío de factura (p. ej. `POST /facturas/{id}/enviar` o `PATCH /facturas/{id}`). |
| **F1-03** | Media | Ausente (no hay `paths: /health`) | US-000 línea 271 ("`GET /api/health` devuelve `{ status: "ok" }`"; `GET /api/docs`) | El contrato **no documenta `GET /api/health`** que US-000 exige, ni `GET /api/docs` / `/api/docs-json`. Revisar: documentar `/health` (o declarar explícitamente que es operativo y queda fuera del contrato de negocio). |
| **F1-04** | Media | `GET /clientes` (listar/buscar) | er-diagram §3.4: "[Cliente] es un atributo de la reserva, **no un punto de entrada de navegación**" | El endpoint de **listado/búsqueda de clientes** contradice la decisión de modelado del ER. No hay US que pida navegar por clientes (el alta de lead embebe el cliente; US-035 actualiza IBAN). Revisar: justificar el endpoint o eliminar la superficie de navegación por cliente. |
| **F1-05** | Media | `GET /reservas/{id}/extras`, `POST /reservas/{id}/extras` | SIN FUENTE de US dedicada (relación indirecta con US-014/US-015/US-027) | Endpoints de gestión de extras de reserva **sin user story propia**. Los extras aparecen embebidos en presupuesto (US-014) y liquidación (US-027), no como recurso gestionado de forma independiente. Revisar: confirmar si "añadir extra" es una acción de primera clase o debe integrarse en presupuesto/liquidación. |
| **F1-06** | Media | `POST /reservas/{id}/fianza/solicitar-iban` | US-035 líneas 21-29 (E5/E8); _trazabilidad área 8 (la solicitud E5 se dispara automáticamente al entrar en `post_evento`, US-034) | La **solicitud de IBAN es automática** (E5 al entrar en `post_evento`), no una acción manual. El endpoint manual `solicitar-iban` tiene soporte débil. Revisar: confirmar si procede una solicitud manual o si solo aplica el registro (PATCH cliente) + E8 automático. |
| **F1-07** | Baja | `PATCH /reservas/{id}` (`UpdateReservaRequest`) | SIN FUENTE de US dedicada | Edición genérica de datos núcleo de la reserva sin US específica. La actualización de invitados está implícita en US-007. Revisar: acotar qué campos son editables y por qué US. |
| **F1-08** | Baja | `GET /auth/me` | SIN FUENTE (soporte de sesión; US-000A/US-001) | Endpoint sin US explícita; razonable como soporte de restauración de sesión del shell. Revisar: documentar su origen o asociarlo a US-000A. |
| **F1-09** | Baja | `POST /auth/logout` (hereda `bearerAuth` global) | US-002 línea 85 ("requiere un token válido **o al menos el refresh token en cookie**") | Logout exige `bearerAuth` (access token); US-002 admite identificar la sesión mediante el refresh token en cookie. Posible desajuste si el access token ya expiró. Revisar: permitir logout con refresh cookie. |

**Endpoints huérfanos adicionales (Baja):** `GET /reservas` (listado/pipeline) no tiene US explícita de "listar pipeline"; se apoya en navegación general (US-000A). Se documenta como traza débil, no como invención de negocio.

---

## Tipo 2 — Schemas ↔ ER diagram

| ID | Sev. | Ubicación (api-spec.yml) | Evidencia en fuente | Hallazgo y recomendación |
|---|---|---|---|---|
| **F2-01** | Media | Schemas `Reserva`, `Presupuesto`, `Factura`, `Pago`, `CalculoTarifaResponse` (campos de importe: `type: number, format: double`) | er-diagram §3.5/§3.11/§3.12 (`importe_total`, `total`, `precio_total_eur`… = `DECIMAL(10,2)`) | Los importes monetarios se modelan como **`number`/`double`** (coma flotante), divergiendo del **`Decimal(10,2)`** del ER. Riesgo de redondeo en facturación (señal 40% / liquidación 60% / IVA 21%). Revisar: representar importes como `string` decimal o documentar la precisión exacta. |
| **F2-02** | Media | Schema `Reserva` | er-diagram §3.5 (RESERVA incluye `visita_programada_fecha/hora`, `visita_realizada`, `fianza_eur`, `fianza_cobrada_fecha`, `fianza_devuelta_fecha/eur`, `cond_part_firmadas` + fechas) | El schema de respuesta `Reserva` **omite campos del ER** que US-008/009 (visita), US-024 (condiciones particulares) y US-030/036 (fianza) leen o escriben. Las peticiones existen (`ProgramarVisitaRequest`, etc.) pero el recurso de lectura no los expone. Revisar: completar la proyección de `Reserva` o documentar sub-recursos de lectura. |
| **F2-03** | Baja | Todos los schemas (p. ej. `idReserva`, `fechaEvento`, `tipoBloqueo`) | er-diagram §2/§3 (`id_reserva`, `fecha_evento`, `tipo_bloqueo` en `snake_case`) | Las propiedades del contrato usan **`camelCase`** frente al **`snake_case`** del ER y de las columnas de BD. Es una convención de API legítima, pero diverge de la fuente y no se documenta el mapeo. Revisar: declarar explícitamente la convención de mapeo JSON↔columna. |
| **F2-04** | Baja | Sección `components/schemas` | er-diagram §3.2/§3.6 (catálogo)/§3.7/§3.8/§3.17 | Entidades del ER **sin schema** en el contrato: `Tenant`, `TenantSettings`, `Tarifa`, `TemporadaCalendario`, `Extra` (catálogo), `AuditLog`. Varias no requieren superficie API en MVP; conviene confirmar al menos catálogo de `Extra` y configuración (`TenantSettings`). Revisar: decidir qué entidades necesitan representación y cuáles quedan internas. |

**Verificado OK (sin hallazgo):** los **enums** del contrato coinciden con el ER — `EstadoReserva` (consulta, pre_reserva, reserva_confirmada, evento_en_curso, post_evento, reserva_completada, reserva_cancelada), `SubEstadoConsulta` (2a–2z), `FianzaStatus` (pendiente, recibo_enviado, cobrada, devuelta, retenida_parcial), `TipoFactura` (senal, liquidacion, fianza, complementaria), `CanalEntrada`, `TipoDocumento`, `CodigoEmail` (E1–E8, manual). Los identificadores usan `format: uuid`, consistente con las PK UUID del ER (er-diagram §4).

---

## Tipo 3 — Auth ↔ architecture §2.8

| ID | Sev. | Ubicación (api-spec.yml) | Evidencia en fuente | Hallazgo y recomendación |
|---|---|---|---|---|
| **F3-01** | Baja | `components/securitySchemes` (`bearerAuth`); `POST /auth/refresh`; `POST /auth/logout` | architecture §2.8 ("refresh token en cookie httpOnly + Secure + SameSite") | El **refresh token en cookie httpOnly** se describe solo en prosa; **no se modela como `securityScheme`** (p. ej. `cookieAuth`) ni se declara la cookie en `/auth/refresh` ni `/auth/logout`. Revisar: modelar la cookie de refresh en el contrato para que sea explícita. |

**Verificado OK (sin hallazgo):** el esquema de seguridad es **JWT Bearer** (`bearerAuth`, `bearerFormat: JWT`), conforme a §2.8. El **aislamiento multi-tenant es correcto**: `tenant_id` se deriva del payload firmado del JWT (descrito en `bearerAuth`) y **no aparece como parámetro de ruta ni de body** en ningún endpoint, evitando suplantación de tenant — alineado con §2.8 ("Tenant y rol en el payload firmado"). El flujo de **refresh** (`/auth/refresh`) y de **login** (devuelve `accessToken`) existe y coincide con el patrón access+refresh de §2.8.

---

## Tipo 4 — Conceptos ajenos (contaminación de plantilla)

**Resultado: LIMPIO — 0 hallazgos.**

Búsqueda en `docs/api-spec.yml` de los términos `interview`, `hiring`, `candidate`, `application` (en sentido ATS), `ATS`, `resume`, `position`, `recruit`: **ninguna coincidencia**. Todas las entidades del contrato (`Reserva`, `Cliente`, `Presupuesto`, `Factura`, `Pago`, `FichaOperativa`, `Documento`, `Comunicacion`, `FechaBloqueada`, `ReservaExtra`) existen en el `er-diagram.md`. No se detecta contaminación de la plantilla de reclutamiento/ATS.

> Observación (no es hallazgo del contrato): se verificó únicamente el artefacto bajo auditoría. El conjunto `info.title`, `tags` y descripciones es coherente con el dominio de espacios de eventos.

---

## Tipo 5 — Detalles inventados / NO ESPECIFICADO

| ID | Sev. | Ubicación (api-spec.yml) | Evidencia en fuente | Hallazgo y recomendación |
|---|---|---|---|---|
| **F5-01** | Media | Schema `ErrorResponse` (`statusCode`, `message`, `error`) y `responses` reutilizables | SIN FUENTE | Ninguna fuente define un **envoltorio de error**. La forma `{statusCode, message, error}` es una convención de NestJS no respaldada por el ER, las US ni la spec funcional. Revisar: acordar y documentar el contrato de error como decisión explícita. |
| **F5-02** | Media | Códigos de respuesta `409` (conflicto) y `422` (transición no permitida) | er-diagram §1 dec. #2 (violación UNIQUE determinista) respalda el *concepto* de conflicto; el mapeo HTTP exacto es SIN FUENTE; `422` SIN FUENTE | El uso de **409** para "fecha ya bloqueada" es conceptualmente coherente con el ER (violación de unicidad determinista), pero **el código HTTP concreto no está en ninguna fuente**. El **422** para transiciones inválidas es totalmente SIN FUENTE. Revisar: fijar la tabla de códigos de estado como decisión documentada. |
| **F5-03** | Baja | `PaginationMetadata` (`total`, `page`, `limit`, `totalPages`) | US-042 línea 111 respalda *que debe haber paginación*; la **forma** del envoltorio es SIN FUENTE | El **concepto** de paginación está respaldado (US-042: "la paginación debe aplicarse siempre"), pero la **estructura concreta** del metadato no la define ninguna fuente. Revisar: documentar el contrato de paginación. |
| **F5-04** | Baja | `parameters` `Page`/`Limit` (`default: 20`, `maximum: 100`) | SIN FUENTE | Los valores `default 20` y `máximo 100` **no están en ninguna fuente**. Revisar: confirmar los límites con el PO. |
| **F5-05** | Baja | `securitySchemes.cronToken` (header `X-Cron-Token`) | US-012 líneas 34/49/136 respaldan auth *service-to-service*; el **nombre/forma del header** es SIN FUENTE | El mecanismo de protección del barrido está respaldado por US-012, pero el **nombre de cabecera `X-Cron-Token`** y su forma (`apiKey`) son una invención. Revisar: definir el mecanismo concreto de autenticación service-to-service. |
| **F5-06** | Baja | `servers` (`https://api.slotify.app`, `http://localhost:3000/api`) | SIN FUENTE | Los **dominios de servidor** no están definidos por ninguna fuente. Revisar: confirmar URLs reales antes de publicar. |

---

## Matriz de trazabilidad bidireccional (Tipo 1)

### A) Cada path+verbo del contrato → US que lo justifica

| Path + verbo | US que lo justifica |
|---|---|
| `POST /auth/login` | US-001 |
| `POST /auth/refresh` | US-001 |
| `POST /auth/logout` | US-002 |
| `GET /auth/me` | **Débil** (soporte de sesión; sin US — F1-08) |
| `GET /reservas` | **Débil** (pipeline; sin US explícita) |
| `POST /reservas` | US-003, US-004 |
| `GET /reservas/{id}` | US-003…US-038 (detalle, soporte transversal) |
| `PATCH /reservas/{id}` | **Débil** (sin US dedicada — F1-07) |
| `POST /reservas/{id}/transiciones` | US-005⚠(F1-01), US-007, US-013, US-032, US-034, US-038 |
| `POST /reservas/{id}/extender-bloqueo` | US-006 |
| `POST /reservas/{id}/visita` | US-008 |
| `PATCH /reservas/{id}/visita` | US-009, US-010, US-011 |
| `GET /reservas/{id}/cola` | US-017 |
| `POST /reservas/{id}/promover` | US-018, US-019 |
| `POST /reservas/{id}/salir-cola` | US-020 |
| `POST /tarifas/calcular` | US-016 |
| `GET /reservas/{id}/presupuestos` | US-014, US-015 |
| `POST /reservas/{id}/presupuestos` | US-014 |
| `PATCH /presupuestos/{id}` | US-015 |
| `GET /reservas/{id}/extras` | **Débil** (sin US dedicada — F1-05) |
| `POST /reservas/{id}/extras` | **Débil** (US-014/US-027 indirecto — F1-05) |
| `POST /reservas/{id}/pagos` | US-021, US-029, US-030 |
| `GET /reservas/{id}/facturas` | US-022, US-027 |
| `POST /reservas/{id}/facturas` | US-022, US-027 |
| `POST /reservas/{id}/condiciones-particulares` | US-023, US-024 |
| `PATCH /reservas/{id}/subprocesos` | US-025, US-027, US-029, US-030 |
| `POST /reservas/{id}/fianza/solicitar-iban` | **Débil** (UC-26/US-035; solicitud es automática — F1-06) |
| `POST /reservas/{id}/fianza/devolucion` | US-036 |
| `GET /reservas/{id}/ficha-operativa` | US-025, US-033 |
| `PUT /reservas/{id}/ficha-operativa` | US-025 |
| `GET /calendario` | US-039 |
| `POST /fechas-bloqueadas` | US-040 |
| `DELETE /fechas-bloqueadas/{id}` | US-041 |
| `GET /clientes` | **HUÉRFANO / conflicto de diseño** (F1-04) |
| `POST /clientes` | **Débil** (US-003/US-004 embeben cliente) |
| `GET /clientes/{id}` | US-014, US-035 (soporte) |
| `PATCH /clientes/{id}` | US-035 (IBAN), US-014 (datos fiscales) |
| `GET /historico/reservas` | US-042 |
| `GET /historico/exportar` | US-043 |
| `GET /dashboard` | US-044 |
| `GET /reservas/{id}/comunicaciones` | US-045, US-046 |
| `POST /reservas/{id}/comunicaciones` | US-045, US-046 |
| `POST /documentos` | US-023, US-024, US-033 |
| `POST /cron/barrido` | US-012, US-018, US-026, US-031, US-037 |

### B) Cada US → endpoint(s) en el contrato

| US | Endpoint(s) | Estado |
|---|---|---|
| US-000 (scaffolding) | `GET /api/health`, `GET /api/docs` | **SIN ENDPOINT** (F1-03) |
| US-000A (app shell) | — | N/A (solo frontend) |
| US-001 (login) | `POST /auth/login`, `POST /auth/refresh` | ✅ |
| US-002 (logout) | `POST /auth/logout` | ✅ (ver F1-09) |
| US-003 (alta exploratoria) | `POST /reservas` | ✅ |
| US-004 (alta con fecha) | `POST /reservas`, `POST /fechas-bloqueadas` | ✅ |
| US-005 (2.a→2.b con fecha) | `POST /reservas/{id}/transiciones` | ⚠ **Parcial** — falta `fechaEvento` (F1-01) |
| US-006 (extender bloqueo) | `POST /reservas/{id}/extender-bloqueo` | ✅ |
| US-007 (→2.c pendiente invitados) | `POST .../transiciones` + `PATCH /reservas/{id}` | ✅ |
| US-008 (programar visita) | `POST /reservas/{id}/visita` | ✅ |
| US-009/010/011 (resultado visita) | `PATCH /reservas/{id}/visita` (+ transiciones) | ✅ |
| US-012 (expirar auto) | `POST /cron/barrido` | ✅ |
| US-013 (descartar cliente) | `POST .../transiciones` (→2.z) | ✅ |
| US-014 (generar presupuesto) | `POST /reservas/{id}/presupuestos` | ✅ |
| US-015 (editar/reenviar presup.) | `PATCH /presupuestos/{id}` | ✅ |
| US-016 (motor tarifa) | `POST /tarifas/calcular` | ✅ |
| US-017 (visualizar cola) | `GET /reservas/{id}/cola` | ✅ |
| US-018 (promoción auto) | `POST /cron/barrido`, `POST .../promover` | ✅ |
| US-019 (promoción manual) | `POST /reservas/{id}/promover` | ✅ |
| US-020 (salir cola) | `POST /reservas/{id}/salir-cola` | ✅ |
| US-021 (cobro señal) | `POST /reservas/{id}/pagos` | ✅ |
| US-022 (factura señal) | `POST /reservas/{id}/facturas` | ✅ |
| US-023 (enviar cond. particulares) | `POST .../condiciones-particulares`, `POST /documentos` | ✅ |
| US-024 (firma cond. particulares) | `POST .../condiciones-particulares` | ✅ |
| US-025 (ficha operativa) | `PUT /reservas/{id}/ficha-operativa` | ✅ |
| US-026 (cierre ficha T-1d) | `POST /cron/barrido` | ✅ |
| US-027 (borradores liq./fianza) | `POST /reservas/{id}/facturas` | ✅ parcial |
| US-028 (aprobar/enviar liquidación) | — | **SIN ENDPOINT** (F1-02) |
| US-029 (cobro liquidación) | `POST /reservas/{id}/pagos` | ✅ |
| US-030 (cobro fianza) | `POST /reservas/{id}/pagos` | ✅ |
| US-031 (inicio auto evento) | `POST /cron/barrido` | ✅ |
| US-032 (forzar inicio) | `POST .../transiciones` | ✅ |
| US-033 (capturar documentación) | `POST /documentos` | ✅ |
| US-034 (finalizar evento) | `POST .../transiciones` | ✅ |
| US-035 (registrar IBAN) | `PATCH /clientes/{id}` | ✅ (E8 implícito; ver F1-06) |
| US-036 (devolución fianza) | `POST /reservas/{id}/fianza/devolucion` | ✅ |
| US-037 (archivado auto) | `POST /cron/barrido` | ✅ |
| US-038 (archivado manual) | `POST .../transiciones` | ✅ |
| US-039 (calendario) | `GET /calendario` | ✅ |
| US-040 (bloquear fecha) | `POST /fechas-bloqueadas` | ✅ |
| US-041 (liberar fecha) | `DELETE /fechas-bloqueadas/{id}` | ✅ |
| US-042 (buscar histórico) | `GET /historico/reservas` | ✅ |
| US-043 (exportar CSV) | `GET /historico/exportar` | ✅ |
| US-044 (dashboard) | `GET /dashboard` | ✅ |
| US-045 (email automático) | `POST /reservas/{id}/comunicaciones` | ✅ |
| US-046 (revisar/enviar borrador) | `POST`/`GET /reservas/{id}/comunicaciones` | ✅ |

**Cobertura:** 44/46 US con endpoint pleno; 2 US **SIN ENDPOINT** (US-000 health, US-028 envío liquidación); 1 US **parcial** (US-005 asignación de fecha). US-000A es solo frontend (N/A).

---

## Veredicto

**¿El `api-spec.yml` es trazable a la spec? → PARCIAL.**

La gran mayoría de los endpoints (42 de 44 paths) se trazan a una user story y todos los enums y la seguridad multi-tenant son coherentes con el ER y con architecture §2.8. **No hay contaminación de plantilla ATS** (Tipo 4 limpio). Sin embargo, la trazabilidad NO es completa: hay **dos US sin endpoint** y **una transición no expresable**, además de varios **detalles inventados sin respaldo en ninguna fuente** (envoltorio de error, códigos de estado, parámetros de paginación, cabecera de cron, dominios) y una **divergencia de tipo en importes** (double vs `Decimal(10,2)`).

### Los 3 hallazgos más críticos a resolver primero

1. **F1-01 (Alta)** — No existe forma de **asignar `fecha_evento`** a una consulta (`TransicionRequest` y `UpdateReservaRequest` carecen del campo). Bloquea US-005 (2.a→2.b) y, con ella, la activación del bloqueo atómico de fecha, que es el núcleo crítico del sistema.
2. **F1-02 (Alta)** — No hay endpoint para **aprobar/enviar una factura** ni para transicionar su `estado`. US-028 (envío de la liquidación con efecto cascada sobre `fianza_status` y disparo de E4) queda sin contrato.
3. **F2-01 (Media)** — Los **importes** se modelan como `double` en vez de `Decimal(10,2)` (ER §3.5/§3.12). Riesgo de redondeo en señal/liquidación/IVA; debe corregirse antes de implementar facturación.

---

*Informe de auditoría de contrato, solo lectura. No se modificó `api-spec.yml` ni ninguna fuente. Único artefacto escrito: este documento.*
