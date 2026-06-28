# Documentación del Modelo de Datos — Slotify

> **Documento**: Modelo de Datos (definición de entidades, campos y reglas)
> **Proyecto**: Slotify — Plataforma SaaS de Gestión Integral para Espacios Boutique de Eventos Privados
> **Versión**: 1.0
> **Fecha**: 04/06/2026
> **Fuente canónica del ERD**: [er-diagram.md](./er-diagram.md) · **Arquitectura**: [architecture.md](./architecture.md) · **Casos de uso**: [use-cases.md](./use-cases.md)

---

## Propósito de este documento

Este documento describe el modelo de datos de Slotify a nivel de **campos, tipos, reglas de validación y relaciones**, pensado para que un Agente IA pueda traducirlo directamente al `schema.prisma` y a las entidades de dominio (NestJS, arquitectura hexagonal). El **diagrama entidad-relación canónico** vive en [er-diagram.md](./er-diagram.md); aquí no se duplica el diagrama, sino que se detalla cada entidad para implementación.

**Convención de nomenclatura (ver [base-standards.md](./base-standards.md)):** el lenguaje ubicuo del dominio es **español** (entidades, columnas y conceptos de negocio: `Reserva`, `fecha_evento`, `FechaBloqueada`). El andamiaje técnico (decoradores, tipos del framework, palabras clave) sigue las convenciones estándar de TypeScript/Prisma. En Prisma los modelos se nombran en `PascalCase` español (`Reserva`, `FechaBloqueada`) y se mapean a tablas `snake_case` español con `@@map`.

---

## 1. Principios de diseño del modelo

1. **La Reserva es el agregado raíz.** La consulta no es una entidad aparte: es una fase de la reserva. Toda la máquina de estados (consulta `2.a–2.z` → `pre_reserva` → `reserva_confirmada` → `reserva_completada`) se modela como cambios del campo `estado`/`sub_estado` de una única entidad `Reserva`.
2. **Multi-tenancy desde el día 1.** `tenant_id` está presente en toda entidad de negocio. El aislamiento se refuerza con Row-Level Security (RLS) en PostgreSQL. Un tenant = un espacio.
3. **Claves primarias UUID** en todas las entidades (anti-enumeración, no fuga de volumen entre tenants).
4. **Bloqueo atómico de fecha** garantizado por la base de datos: restricción `UNIQUE(tenant_id, fecha)` sobre `FechaBloqueada` + transacciones con `SELECT ... FOR UPDATE`.
5. **Cola de espera como campos en la reserva** (`posicion_cola`, `consulta_bloqueante_id`), sin tabla auxiliar.
6. **Sub-procesos paralelos como atributos ENUM** de la reserva (`pre_evento_status`, `liquidacion_status`, `fianza_status`).
7. **Documentos polimórficos** en una única tabla `Documento` con discriminador `tipo`.
8. **Precios congelados en la línea** (`ReservaExtra.precio_unitario`), no en el catálogo.
9. **Tercera forma normal (3NF)**; soft-delete con `activo` donde aplica; auditoría con `fecha_creacion`/`fecha_actualizacion` en entidades mutables.

---

## 2. Catálogo de entidades

| # | Entidad (Prisma) | Tabla (`@@map`) | Descripción | UC relacionados |
|---|---|---|---|---|
| 1 | `Tenant` | `tenant` | Espacio boutique (masía, finca, villa). Raíz del multi-tenancy | UC-01, UC-02 |
| 2 | `TenantSettings` | `tenant_settings` | Configuración por tenant (TTLs, %, fianza, idioma) | Transversal |
| 3 | `Usuario` | `usuario` | Gestor/admin/operario del sistema | UC-01, UC-02 |
| 4 | `Cliente` | `cliente` | Datos de contacto y fiscales del cliente | UC-03, UC-14 |
| 5 | `Reserva` | `reserva` | **Entidad central.** Recorre toda la máquina de estados | UC-03 a UC-28 |
| 6 | `FechaBloqueada` | `fecha_bloqueada` | Bloqueo atómico de fecha con TTL | UC-30, UC-31 |
| 7 | `Tarifa` | `tarifa` | Precios precalculados (temporada × duración × invitados) | UC-16 |
| 8 | `TemporadaCalendario` | `temporada_calendario` | Mapeo mes → temporada | UC-16 |
| 9 | `Extra` | `extra` | Catálogo de extras del tenant | UC-14, UC-16 |
| 10 | `ReservaExtra` | `reserva_extra` | Línea de extra con precio congelado y factura asociada | UC-14, UC-21 |
| 11 | `Presupuesto` | `presupuesto` | Versiones del presupuesto PDF | UC-14, UC-15 |
| 12 | `Factura` | `factura` | Factura de señal, liquidación, fianza o complementaria | UC-18, UC-21 |
| 13 | `Pago` | `pago` | Cobro conciliado contra una factura | UC-17, UC-21, UC-22 |
| 14 | `FichaOperativa` | `ficha_operativa` | Datos operativos del evento (1:1 con reserva) | UC-20, UC-24 |
| 15 | `Documento` | `documento` | Archivos adjuntos polimórficos | UC-19, UC-24 |
| 16 | `Comunicacion` | `comunicacion` | Log de emails (E1–E8 + manuales) | UC-35, UC-36 |
| 17 | `AuditLog` | `audit_log` | Registro de auditoría | Transversal |

---

## 3. Descripción de entidades

> Tipos expresados en notación Prisma. `?` = nullable. `@id` = clave primaria. `@unique` y `@@unique([...])` = restricciones de unicidad. Todas las FK referencian el `@id` de la entidad destino.

### 3.1 Tenant
Espacio boutique de eventos. Entidad raíz del multi-tenancy. Un tenant = un espacio.

| Campo | Tipo | Reglas / Notas |
|---|---|---|
| `id_tenant` | `String @id @default(uuid())` | Identificador único |
| `nombre` | `String` | Nombre del espacio (ej. "Masia l'Encís"), máx. 100 |
| `email_contacto` | `String` | Email de contacto, formato email, máx. 255 |
| `telefono` | `String?` | Máx. 20 |
| `direccion` | `String?` | Máx. 255 |
| `iban` | `String?` | IBAN para cobros, máx. 34 |
| `nif` | `String?` | NIF/CIF del tenant, máx. 15 |
| `capacidad_maxima` | `Int?` | Aforo máximo del espacio, `> 0` |
| `activo` | `Boolean @default(true)` | Soft-delete |
| `fecha_creacion` | `DateTime @default(now())` | Auditoría |
| `fecha_actualizacion` | `DateTime @updatedAt` | Auditoría |

**Relaciones:** 1:1 con `TenantSettings`; 1:N con `Usuario`, `Cliente`, `Reserva`, `FechaBloqueada`, `Tarifa`, `TemporadaCalendario`, `Extra`, `Factura`, `Documento`, `Comunicacion`, `AuditLog`.

### 3.2 TenantSettings
Configuración ajustable por tenant ("opinado por fuera, configurable por dentro"). Relación 1:1 con `Tenant`.

| Campo | Tipo | Reglas / Notas |
|---|---|---|
| `id_settings` | `String @id @default(uuid())` | |
| `tenant_id` | `String @unique` | FK → `Tenant` (1:1) |
| `pct_senal` | `Decimal @db.Decimal(4,2)` | Porcentaje de señal (40.00 en MVP), `0–100` |
| `fianza_default_eur` | `Decimal @db.Decimal(10,2)` | Importe por defecto de fianza, `>= 0` |
| `ttl_consulta_dias` | `Int` | TTL bloqueo blando de consulta (3 por defecto) |
| `ttl_prereserva_dias` | `Int` | TTL bloqueo de pre-reserva (7 por defecto) |
| `max_dias_programar_visita` | `Int` | Máx. días desde solicitud para visita (7) |
| `idioma` | `String @default("es")` | Idioma de plantillas |
| `fecha_actualizacion` | `DateTime @updatedAt` | |

### 3.3 Usuario
Gestores, administradores y operarios. **En el MVP todos los usuarios reales tienen `rol = gestor`** (un único gestor por tenant aprovisionado por seed; ver [architecture.md §2.8](./architecture.md)).

| Campo | Tipo | Reglas / Notas |
|---|---|---|
| `id_usuario` | `String @id @default(uuid())` | |
| `tenant_id` | `String` | FK → `Tenant` |
| `email` | `String @unique` | Email de acceso, formato email |
| `password_hash` | `String` | Hash bcrypt/argon2. **Nunca se devuelve por la API** |
| `nombre` | `String` | |
| `apellidos` | `String?` | |
| `rol` | `Rol @default(gestor)` | enum `gestor \| admin \| operario` |
| `activo` | `Boolean @default(true)` | |
| `ultimo_acceso` | `DateTime?` | |
| `fecha_creacion` | `DateTime @default(now())` | |
| `fecha_actualizacion` | `DateTime @updatedAt` | |

### 3.4 Cliente
Datos de contacto y fiscales. Es un atributo de la reserva, no un punto de entrada de navegación.

| Campo | Tipo | Reglas / Notas |
|---|---|---|
| `id_cliente` | `String @id @default(uuid())` | |
| `tenant_id` | `String` | FK → `Tenant` |
| `nombre` | `String` | Requerido, 2–100 |
| `apellidos` | `String?` | |
| `email` | `String?` | Formato email, máx. 255 |
| `telefono` | `String?` | Máx. 20 |
| `dni_nif` | `String?` | Requerido para facturación, máx. 15 |
| `direccion` | `String?` | Dato fiscal |
| `codigo_postal` | `String?` | Dato fiscal |
| `poblacion` | `String?` | Dato fiscal |
| `provincia` | `String?` | Dato fiscal |
| `iban_devolucion` | `String?` | IBAN para devolución de fianza, máx. 34 |
| `activo` | `Boolean @default(true)` | |
| `fecha_creacion` / `fecha_actualizacion` | `DateTime` | Auditoría |

**Regla:** para generar presupuesto/factura (`UC-14`, `UC-18`) son obligatorios `dni_nif`, `direccion`, `codigo_postal`, `poblacion`, `provincia`.

### 3.5 Reserva (entidad central)
Recorre toda la máquina de estados. Incluye campos de cola, visita, sub-procesos paralelos y fianza.

| Campo | Tipo | Reglas / Notas |
|---|---|---|
| `id_reserva` | `String @id @default(uuid())` | |
| `tenant_id` | `String` | FK → `Tenant` |
| `cliente_id` | `String` | FK → `Cliente` |
| `codigo` | `String @unique` | Código de negocio `SLO-2026-0001` |
| `estado` | `EstadoReserva` | enum (ver más abajo) |
| `sub_estado` | `SubEstadoConsulta?` | Válido solo cuando `estado = consulta` |
| `canal_entrada` | `CanalEntrada` | `web \| email \| whatsapp \| instagram \| telefono` |
| `fecha_evento` | `DateTime? @db.Date` | `>= hoy`; opcional en `2.a` |
| `duracion_horas` | `DuracionHoras?` | enum `4 \| 8 \| 12` |
| `tipo_evento` | `TipoEvento?` | `boda \| corporativo \| privado \| otro` |
| `num_adultos_ninos_mayores4` | `Int?` | Cuenta para tarifa |
| `num_ninos_menores4` | `Int?` | Informativo, no afecta tarifa |
| `num_invitados_final` | `Int?` | Nº final confirmado |
| `importe_total` | `Decimal? @db.Decimal(10,2)` | Total del presupuesto aceptado |
| `importe_senal` | `Decimal? @db.Decimal(10,2)` | 40% de señal |
| `importe_liquidacion` | `Decimal? @db.Decimal(10,2)` | 60% de liquidación |
| `ttl_expiracion` | `DateTime?` | Expiración del bloqueo blando vigente |
| `pre_evento_status` | `PreEventoStatus @default(pendiente)` | `pendiente \| en_curso \| cerrado` |
| `liquidacion_status` | `LiquidacionStatus @default(pendiente)` | `pendiente \| facturada \| cobrada` |
| `fianza_status` | `FianzaStatus @default(pendiente)` | `pendiente \| recibo_enviado \| cobrada \| devuelta \| retenida_parcial` |
| `posicion_cola` | `Int?` | FIFO; no nulo solo en sub-estado `2.d` |
| `consulta_bloqueante_id` | `String?` | FK auto-referencia → `Reserva` que bloquea la fecha |
| `visita_programada_fecha` | `DateTime? @db.Date` | Sub-estado `2.v` |
| `visita_programada_hora` | `String?` | `HH:mm` |
| `visita_realizada` | `Boolean @default(false)` | |
| `fianza_eur` | `Decimal? @db.Decimal(10,2)` | Importe de fianza cobrada |
| `fianza_cobrada_fecha` | `DateTime?` | |
| `fianza_devuelta_fecha` | `DateTime?` | |
| `fianza_devuelta_eur` | `Decimal? @db.Decimal(10,2)` | Importe devuelto (parcial por desperfectos) |
| `cond_part_firmadas` | `Boolean @default(false)` | |
| `cond_part_enviadas_fecha` | `DateTime?` | |
| `cond_part_firmadas_fecha` | `DateTime?` | |
| `notas` | `String? @db.Text` | |
| `activo` | `Boolean @default(true)` | |
| `fecha_creacion` / `fecha_actualizacion` | `DateTime` | Auditoría |

**`EstadoReserva`:** `consulta`, `pre_reserva`, `reserva_confirmada`, `evento_en_curso`, `post_evento`, `reserva_completada`, `reserva_cancelada`.

**`SubEstadoConsulta`** (válido cuando `estado = consulta`):
- `2a` — Consulta exploratoria (sin fecha, sin bloqueo).
- `2b` — Consulta con fecha (bloqueo blando 3 días).
- `2c` — Pendiente de invitados (bloqueo extendido +3 días).
- `2d` — En cola de espera (`consulta_bloqueante_id` apunta a la bloqueante).
- `2v` — Visita programada (bloqueo hasta día post-visita).
- `2x` — Expirada (terminal).
- `2y` — Descartada por cola (terminal).
- `2z` — Descartada por cliente (terminal).

**Guarda de transición a `evento_en_curso`:** `pre_evento_status = cerrado AND liquidacion_status = cobrada AND fianza_status = cobrada`.

### 3.6 FechaBloqueada
Bloqueo atómico de fecha. La restricción `@@unique([tenant_id, fecha])` traslada la garantía de no-doble-reserva al motor de PostgreSQL. Dos operaciones transaccionales del dominio mutuan esta entidad: `bloquearFecha()` (UC-30 / US-040) en los flujos de inserción, extensión y promoción a firme, y `liberarFecha()` (UC-31 / US-041) que elimina la fila de forma atómica e idempotente.

| Campo | Tipo | Reglas / Notas |
|---|---|---|
| `id_bloqueo` | `String @id @default(uuid())` | |
| `tenant_id` | `String` | FK → `Tenant`. Parte de la restricción única compuesta |
| `fecha` | `DateTime @db.Date` | Parte de `@@unique([tenant_id, fecha])` |
| `reserva_id` | `String @unique` | FK → `Reserva` que mantiene el bloqueo. `@unique` impone 1:1 reserva↔bloqueo: una reserva solo puede bloquear una fecha |
| `tipo_bloqueo` | `TipoBloqueo` | `blando` (con TTL) \| `firme` (sin TTL, reserva confirmada). Coherencia impuesta por check constraints de la BD |
| `ttl_expiracion` | `DateTime?` | `NULL` si `firme`; `NOT NULL` si `blando`. Impuesto en BD por `chk_firme_sin_ttl` y `chk_blando_con_ttl` |
| `fecha_creacion` | `DateTime @default(now())` | |

**Restricciones de integridad:**
- `@@unique([tenant_id, fecha])` — garantía anti-doble-reserva en el motor: el segundo `INSERT` concurrente sobre la misma `(tenant_id, fecha)` recibe `P2002` con `ROLLBACK` automático, sin ventana de carrera.
- `reserva_id @unique` — relación 1:1 reserva↔bloqueo: una reserva no puede bloquear dos fechas distintas; facilita el upgrade firme (UPDATE del registro existente, nunca DELETE+INSERT).
- `chk_firme_sin_ttl` — check constraint en BD: `tipo_bloqueo = 'firme' ⟹ ttl_expiracion IS NULL` (migración US-040).
- `chk_blando_con_ttl` — check constraint en BD: `tipo_bloqueo = 'blando' ⟹ ttl_expiracion IS NOT NULL` (migración US-040).

Toda mutación pasa por `bloquearFecha()` (UC-30 / US-040) o `liberarFecha()` (UC-31 / US-041). Ver [backend-standards.md](./backend-standards.md) y [er-diagram.md §3.6](./er-diagram.md) para la semántica completa de liberación (rows-affected, guarda firme, `PromocionColaPort`, liberación en lote).

**Mapa canónico fase → (tipo, TTL, modo)** — implementado como tabla de datos declarativa en el servicio de dominio (no como lógica dispersa):

| Fase | `tipo_bloqueo` | `ttl_expiracion` | modo |
|---|---|---|---|
| `2.b` | `blando` | `now() + TENANT_SETTINGS.ttl_consulta_dias` (3 d por defecto) | insert |
| `2.c` | `blando` | `ttl_actual + TENANT_SETTINGS.ttl_consulta_dias` (extensión) | extend |
| `2.v` | `blando` | `visita_programada_fecha + 1 día` | insert |
| `pre_reserva` | `blando` | `now() + TENANT_SETTINGS.ttl_prereserva_dias` (7 d por defecto) | insert |
| `reserva_confirmada` | `firme` | `NULL` | upgrade |

Los días de TTL se leen siempre de `TENANT_SETTINGS` (nunca hardcodeados).

**Errores de dominio** lanzados por `bloquearFecha()` (tipados, en español):

| Código | Condición |
|---|---|
| `FECHA_YA_BLOQUEADA` | La `(tenant_id, fecha)` ya tiene bloqueo activo de otra `reserva_id`; traducción del `P2002` de Prisma por índice `(tenant_id, fecha)` |
| `FECHA_EN_PASADO` | La fecha es anterior o igual al día actual; validación previa a la transacción, sin tocar la BD |
| `TENANT_MISMATCH` | El `tenant_id` del bloqueo no coincide con el de la `Reserva` referenciada |
| `EXTENSION_SOBRE_BLOQUEO_FIRME` | Intento de extender (modo `extend`) un bloqueo ya `firme`; la máquina de estados no admite degradar un bloqueo firme |
| `RESERVA_YA_TIENE_BLOQUEO` | La reserva ya tiene un bloqueo de fecha asociado; traducción del `P2002` por índice `reserva_id @unique` |

**Errores de dominio** lanzados por `liberarFecha()` (tipados, en español):

| Código | Condición |
|---|---|
| `LIBERACION_FIRME_SIN_CANCELACION` | Intento de liberar un bloqueo `firme` cuya `Reserva` no está en `reserva_cancelada`; validación previa al DELETE; el bloqueo firme permanece intacto |

**Semántica de `liberarFecha()` (UC-31 / US-041):** DELETE vía `$executeRaw` dentro de `$transaction` + RLS (`SET LOCAL app.tenant_id`). `rows = 1` → éxito efectivo + `AUDIT_LOG` + evaluar `PromocionColaPort`. `rows = 0` → éxito silencioso idempotente + `AUDIT_LOG` tentativa. La operación no muta `estado`/`sub_estado` de la `Reserva` (responsabilidad del flujo invocante). Sin endpoint HTTP propio (D-7 / US-041). Ver [er-diagram.md §3.6](./er-diagram.md) para la semántica completa.

### 3.7 Tarifa
Precios precalculados por temporada × duración × invitados (45 entradas: 3×3×5). El motor de cálculo (UC-16 / US-016) busca la fila vigente en `fecha_evento` por `(temporada, duracion_horas, invitados_min ≤ num_adultos_ninos_mayores4 ≤ invitados_max)`. Los niños ≤ 4 años no cuentan para el tramo. Grupos `> 50` invitados no tienen fila; el motor devuelve `tarifa_a_consultar: true` sin error. El campo de salida del motor se llama `precio_tarifa_eur` (no `precio_total_eur`) para distinguir la salida del motor de la columna de la entidad (ver `design.md §D-1`).

| Campo | Tipo | Reglas / Notas |
|---|---|---|
| `id_tarifa` | `String @id @default(uuid())` | |
| `tenant_id` | `String` | FK → `Tenant` |
| `temporada` | `Temporada` | `alta \| media \| baja` |
| `duracion_horas` | `Int` | 4, 8 o 12 |
| `invitados_min` | `Int` | Mínimo del tramo. Tramos Masia l'Encís: **1, 21, 26, 31, 41** |
| `invitados_max` | `Int` | Máximo del tramo. Tramos Masia l'Encís: **20, 25, 30, 40, 50** (>50 = "a consultar", sin fila) |
| `precio_total_eur` | `Decimal @db.Decimal(10,2)` | Con IVA 21% incluido, `>= 0` |
| `vigente_desde` | `DateTime @db.Date` | Versionado |
| `vigente_hasta` | `DateTime? @db.Date` | Nulo = vigente indefinidamente |
| `activo` | `Boolean @default(true)` | |

### 3.8 TemporadaCalendario
Mapeo de cada mes a su temporada para el cálculo de tarifas. El motor (UC-16) consulta esta tabla para determinar la temporada de `fecha_evento`. Si un mes no tiene fila, el motor lanza `TEMPORADA_NO_CONFIGURADA`. El mapeo canónico de Masia l'Encís: Alta = {5,6,7,8,9}, Media = {3,4,10,11}, Baja = {12,1,2}.

| Campo | Tipo | Reglas / Notas |
|---|---|---|
| `id_temporada_cal` | `String @id @default(uuid())` | |
| `tenant_id` | `String` | FK → `Tenant` |
| `temporada` | `Temporada` | `alta \| media \| baja` |
| `mes` | `Int` | 1–12 |

### 3.9 Extra
Catálogo de extras del tenant (barbacoa, paellero). Precio de referencia; no se factura desde aquí (el precio se congela en `ReservaExtra`).

| Campo | Tipo | Reglas / Notas |
|---|---|---|
| `id_extra` | `String @id @default(uuid())` | |
| `tenant_id` | `String` | FK → `Tenant` |
| `nombre` | `String` | Máx. 100 |
| `descripcion` | `String?` | |
| `precio_eur` | `Decimal @db.Decimal(10,2)` | Precio unitario actual, `>= 0` |
| `activo` | `Boolean @default(true)` | |

### 3.10 ReservaExtra
Línea facturable de extra. `precio_unitario` se congela **al añadir la línea**, no al aceptar el presupuesto.

| Campo | Tipo | Reglas / Notas |
|---|---|---|
| `id_reserva_extra` | `String @id @default(uuid())` | |
| `reserva_id` | `String` | FK → `Reserva` |
| `extra_id` | `String?` | FK → `Extra`. Nulo si extra fuera de catálogo |
| `factura_id` | `String?` | FK → `Factura` donde se cobra. Nulo mientras no facturado |
| `concepto_libre` | `String?` | Descripción manual para extras fuera de catálogo |
| `origen` | `OrigenExtra` | `presupuesto \| anadido_post_confirmacion` |
| `cantidad` | `Int` | `>= 1` |
| `precio_unitario` | `Decimal @db.Decimal(10,2)` | Congelado al añadir la línea |
| `subtotal` | `Decimal @db.Decimal(10,2)` | `cantidad × precio_unitario` |
| `fecha_creacion` | `DateTime @default(now())` | |

**Regla de facturación:** las líneas con `factura_id IS NULL` se asignan a la factura de liquidación (T-1d); si la petición llega después de emitida la liquidación, a una factura `complementaria` en post-evento.

### 3.11 Presupuesto
Versiones del presupuesto generado. Cada versión congela la tarifa vigente.

| Campo | Tipo | Reglas / Notas |
|---|---|---|
| `id_presupuesto` | `String @id @default(uuid())` | |
| `reserva_id` | `String` | FK → `Reserva` |
| `version` | `Int` | 1, 2, 3… (único por reserva: `@@unique([reserva_id, version])`) |
| `base_imponible` | `Decimal @db.Decimal(10,2)` | |
| `iva_porcentaje` | `Decimal @db.Decimal(4,2)` | 21.00 por defecto |
| `iva_importe` | `Decimal @db.Decimal(10,2)` | |
| `total` | `Decimal @db.Decimal(10,2)` | |
| `descuento_eur` | `Decimal? @db.Decimal(10,2)` | |
| `descuento_motivo` | `String?` | |
| `tarifa_congelada` | `Boolean @default(true)` | |
| `pdf_url` | `String?` | URL del PDF generado, máx. 500 |
| `estado` | `EstadoPresupuesto` | `borrador \| enviado \| aceptado \| rechazado` |
| `fecha_envio` | `DateTime?` | |
| `fecha_creacion` / `fecha_actualizacion` | `DateTime` | |

### 3.12 Factura
Facturas de señal (40%), liquidación (60% + extras), fianza y complementarias.

| Campo | Tipo | Reglas / Notas |
|---|---|---|
| `id_factura` | `String @id @default(uuid())` | |
| `tenant_id` | `String` | FK → `Tenant` |
| `reserva_id` | `String` | FK → `Reserva` |
| `numero_factura` | `String @unique` | Secuencial `F-2026-0001` |
| `tipo` | `TipoFactura` | `senal \| liquidacion \| fianza \| complementaria` |
| `base_imponible` | `Decimal @db.Decimal(10,2)` | |
| `iva_porcentaje` | `Decimal @db.Decimal(4,2)` | 21.00 |
| `iva_importe` | `Decimal @db.Decimal(10,2)` | |
| `total` | `Decimal @db.Decimal(10,2)` | |
| `concepto` | `String?` | |
| `pdf_url` | `String?` | Máx. 500 |
| `estado` | `EstadoFactura` | `borrador \| enviada \| cobrada` |
| `fecha_emision` | `DateTime?` | |
| `fecha_creacion` / `fecha_actualizacion` | `DateTime` | |

### 3.13 Pago
Cobro conciliado contra una factura. El justificante es un `Documento`.

| Campo | Tipo | Reglas / Notas |
|---|---|---|
| `id_pago` | `String @id @default(uuid())` | |
| `factura_id` | `String` | FK → `Factura` |
| `importe` | `Decimal @db.Decimal(10,2)` | `> 0` |
| `fecha_cobro` | `DateTime @db.Date` | |
| `justificante_doc_id` | `String?` | FK → `Documento` |
| `fecha_creacion` | `DateTime @default(now())` | |

### 3.14 FichaOperativa
Datos operativos del evento, cumplimentados progresivamente. Relación 1:1 con la reserva.

| Campo | Tipo | Reglas / Notas |
|---|---|---|
| `id_ficha` | `String @id @default(uuid())` | |
| `reserva_id` | `String @unique` | FK → `Reserva` (1:1) |
| `num_invitados_confirmado` | `Int?` | |
| `menu_seleccionado` | `String? @db.Text` | |
| `timing_detallado` | `String? @db.Text` | |
| `contacto_evento_nombre` | `String?` | |
| `contacto_evento_telefono` | `String?` | |
| `notas_operativas` | `String? @db.Text` | |
| `briefing_equipo` | `String? @db.Text` | |
| `ficha_cerrada` | `Boolean @default(false)` | |
| `fecha_cierre` | `DateTime?` | |
| `fecha_creacion` / `fecha_actualizacion` | `DateTime` | |

### 3.15 Documento
Archivos adjuntos polimórficos. Discriminador `tipo`. Referenciable desde reserva y desde pago.

| Campo | Tipo | Reglas / Notas |
|---|---|---|
| `id_documento` | `String @id @default(uuid())` | |
| `tenant_id` | `String` | FK → `Tenant` |
| `reserva_id` | `String?` | FK → `Reserva` (nullable) |
| `tipo` | `TipoDocumento` | `dni_anverso \| dni_reverso \| clausula_responsabilidad \| condiciones_particulares \| justificante_pago \| presupuesto \| factura \| otro` |
| `nombre_archivo` | `String` | |
| `url` | `String` | Máx. 500 |
| `mime_type` | `String` | Máx. 50 |
| `tamano_bytes` | `Int?` | Máx. 10 MB |
| `fecha_creacion` | `DateTime @default(now())` | |

### 3.16 Comunicacion
Log de emails enviados (E1–E8 + manuales).

| Campo | Tipo | Reglas / Notas |
|---|---|---|
| `id_comunicacion` | `String @id @default(uuid())` | |
| `tenant_id` | `String` | FK → `Tenant` |
| `reserva_id` | `String?` | FK → `Reserva` (nullable) |
| `cliente_id` | `String` | FK → `Cliente` (destinatario) |
| `codigo_email` | `CodigoEmail` | `E1 … E8 \| manual` |
| `asunto` | `String` | Máx. 255 |
| `cuerpo` | `String? @db.Text` | |
| `destinatario_email` | `String` | |
| `estado` | `EstadoComunicacion` | `borrador \| enviado \| fallido` |
| `fecha_envio` | `DateTime?` | |
| `fecha_creacion` | `DateTime @default(now())` | |

### 3.17 AuditLog
Registro de auditoría de las acciones sobre reservas, facturas, bloqueos de fecha y autenticación.

| Campo | Tipo | Reglas / Notas |
|---|---|---|
| `id_audit` | `String @id @default(uuid())` | |
| `tenant_id` | `String` | FK → `Tenant` |
| `usuario_id` | `String?` | FK → `Usuario`; nulo en operaciones del Sistema (p. ej. barrido de TTL) |
| `entidad` | `String` | Nombre de la entidad afectada |
| `entidad_id` | `String` | ID de la entidad afectada |
| `accion` | `AccionAudit` | `crear \| actualizar \| eliminar \| transicion \| login \| logout` |
| `datos_anteriores` | `Json?` | |
| `datos_nuevos` | `Json?` | Incluye la causa cuando `accion = 'eliminar'` y `entidad = 'FECHA_BLOQUEADA'` |
| `ip_address` | `String?` | |
| `user_agent` | `String?` | |
| `fecha_creacion` | `DateTime @default(now())` | |

**Registros de autenticación `login` / `logout` (US-001 / US-002):** convención `entidad = 'Usuario'`, `entidad_id = usuario_id`; `usuario_id` y `tenant_id` proceden del payload del token. El `login` se registra en todo login exitoso (intentos fallidos no se auditan). El `logout` se registra **solo cuando el refresh token identifica a un usuario**; un segundo logout con token ausente/expirado/inválido no genera registro (`usuario_id` sería nulo y el comportamiento es idempotente silencioso). Ver [er-diagram.md §3.17](./er-diagram.md) para la descripción completa del enum `AccionAudit`.

**Uso por `liberarFecha()` (UC-31 / US-041):** produce registros con `accion = 'eliminar'`, `entidad = 'FECHA_BLOQUEADA'` en tres escenarios: liberación exitosa (causa: `TTL`/`descarte`/`cancelacion` en `datos_nuevos`), tentativa idempotente (`rows = 0`, causa en `datos_nuevos`) e intento rechazado de bloqueo firme (error `LIBERACION_FIRME_SIN_CANCELACION`, `usuario_id` del solicitante si aplica).

---

## 4. Relaciones (resumen)

```
Tenant 1──1 TenantSettings
Tenant 1──N Usuario, Cliente, Reserva, FechaBloqueada, Tarifa,
            TemporadaCalendario, Extra, Factura, Documento, Comunicacion, AuditLog
Cliente 1──N Reserva, Comunicacion
Reserva 1──N Reserva (cola: consulta_bloqueante_id, auto-ref)
Reserva 1──0..1 FechaBloqueada
Reserva 1──N Presupuesto, ReservaExtra, Factura, Documento, Comunicacion
Reserva 1──0..1 FichaOperativa
Extra   1──N ReservaExtra
Factura 1──N ReservaExtra, Pago
Documento 1──0..1 Pago (justificante)
Usuario 1──N AuditLog
```

El diagrama Mermaid completo y con cardinalidades está en [er-diagram.md §2](./er-diagram.md).

---

## 5. Índices recomendados (rendimiento y concurrencia)

| Índice | Entidad | Propósito |
|---|---|---|
| `@@unique([tenant_id, fecha])` | `FechaBloqueada` | Garantía de no-doble-reserva en el motor |
| `@@index([tenant_id, fecha_evento, estado])` | `Reserva` | Calendario y disponibilidad |
| `@@index([tenant_id, consulta_bloqueante_id, posicion_cola])` | `Reserva` | Promoción y reordenación de cola |
| `@@index([tenant_id, email])` | `Cliente` | Búsqueda de cliente y recurrencia |
| Full-text (`nombre`, `codigo`, `notas`) | `Reserva` | Histórico consultable (`UC-32`) |

---

## 6. Reglas de validación transversales

- **Multi-tenant:** toda consulta debe filtrar por `tenant_id` (reforzado por RLS). Una entidad nunca puede referenciar otra de un tenant distinto.
- **Importes:** `Decimal(10,2)`, nunca `Float` (evita errores de redondeo en facturación). Porcentajes en `Decimal(4,2)`.
- **Fechas de evento:** `fecha_evento >= hoy` al crear/transicionar una `Reserva` (salvo histórico ya pasado). El motor de cálculo de tarifa (UC-16 / US-016) aplica una regla más estricta: `fecha_evento` debe ser **estrictamente futura** (no el mismo día, comparación por día natural UTC).
- **IVA:** 21% por defecto; `iva_importe = round(base_imponible × iva_porcentaje / 100, 2)`; `total = base_imponible + iva_importe`.
- **Señal/Liquidación:** `importe_senal = round(importe_total × pct_senal / 100, 2)`; `importe_liquidacion = importe_total − importe_senal`.
- **Soft-delete:** las entidades con `activo` no se borran físicamente; se marcan `activo = false`.
- **Auditoría:** toda transición de estado de `Reserva` y toda emisión de `Factura` genera un `AuditLog`.

---

*Documento de modelo de datos v1.3 (28/06/2026). Derivado y consistente con [er-diagram.md](./er-diagram.md) v2.4. Cualquier cambio en el modelo debe actualizarse en ambos documentos y en `schema.prisma`. v1.3: refleja US-002 — actualiza §3.17 AuditLog: descripción ampliada a "autenticación"; documenta convención `login`/`logout` (`entidad = 'Usuario'`, `entidad_id = usuario_id`) y la condicionalidad del registro de `logout` (solo cuando el token identifica usuario). v1.2: refleja US-041 — `liberarFecha()` (UC-31): error `LIBERACION_FIRME_SIN_CANCELACION`, semántica rows-affected, seam `PromocionColaPort` (diferido a US-018), sin endpoint HTTP (D-7), y registros de auditoría con causa en `AuditLog`. v1.1: refleja US-040 — `reserva_id @unique` en `FechaBloqueada`, check constraints `chk_firme_sin_ttl`/`chk_blando_con_ttl`, mapa canónico fase→(tipo,TTL,modo) y errores de dominio de `bloquearFecha()`.*
