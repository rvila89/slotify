# Documentación del Modelo de Datos — Slotify

> **Documento**: Modelo de Datos (definición de entidades, campos y reglas)
> **Proyecto**: Slotify — Plataforma SaaS de Gestión Integral para Espacios Boutique de Eventos Privados
> **Versión**: 1.4
> **Fecha**: 14/07/2026
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
| 2b | `PlantillaDocumentoTenant` | `plantilla_documento_tenant` | Configuración de documentos PDF por tenant (branding, identidad fiscal, banca, textos y condiciones). Relación 1:1 con `Tenant`. Base del épico #6 | Épico #6 |
| 3 | `Usuario` | `usuario` | Gestor/admin/operario del sistema | UC-01, UC-02 |
| 4 | `Cliente` | `cliente` | Datos de contacto y fiscales del cliente | UC-03, UC-14 |
| 5 | `Reserva` | `reserva` | **Entidad central.** Recorre toda la máquina de estados | UC-03 a UC-28 |
| 6 | `FechaBloqueada` | `fecha_bloqueada` | Bloqueo atómico de fecha con TTL | UC-30, UC-31 |
| 7 | `Tarifa` | `tarifa` | Precios precalculados (temporada × duración × invitados) | UC-16 |
| 8 | `TemporadaCalendario` | `temporada_calendario` | Mapeo mes → temporada | UC-16 |
| 9 | `Extra` | `extra` | Catálogo de extras del tenant | UC-14, UC-16 |
| 10 | `ReservaExtra` | `reserva_extra` | Línea de extra con precio congelado y factura asociada. Primera persistencia real en UC-15 | UC-14, UC-15, UC-21 |
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

### 3.2b PlantillaDocumentoTenant
Configuración de documentos PDF por tenant. Relación 1:1 con `Tenant` (`tenant_id @unique`). Fuente de verdad de los datos que los PDFs de Slotify necesitan (épico #6, rebanada 6.1a). RLS con la misma policy `tenant_isolation`. Tabla `@@map("plantilla_documento_tenant")`.

**Matiz central:** `razon_social_fiscal` (p. ej. "Canoliart, SL") y `nombre_comercial` (p. ej. "Masia l'Encís") son campos DISTINTOS. Ver [er-diagram.md §3.3](./er-diagram.md) y §5.7 para la rationale (decisión A1).

Los campos se agrupan en cinco bloques:

**Bloque branding:**

| Campo | Tipo | Reglas / Notas |
|---|---|---|
| `id_plantilla` | `String @id @default(uuid())` | |
| `tenant_id` | `String @unique` | FK → `Tenant` (garantía 1:1 en BD) |
| `logo_url` | `String?` | URL pública del logo en el almacén. Poblado por el seed en 6.5 (`logos/{tenantId}.jpg`); null si no se ha subido |
| `color_primario` | `String` | Color primario en hexadecimal (`#RRGGBB`). Valor del piloto: `#5edada` (turquesa, actualizado en 6.5) |
| `color_texto` | `String` | Color de texto en hexadecimal |

**Bloque identidad fiscal:**

| Campo | Tipo | Reglas / Notas |
|---|---|---|
| `razon_social_fiscal` | `String` | Razón social del emisor (p. ej. "Canoliart, SL"). DISTINTA del nombre comercial |
| `nombre_comercial` | `String` | Nombre de marca del espacio (p. ej. "Masia l'Encís") |
| `nif` | `String` | NIF/CIF del emisor |
| `direccion_fiscal` | `String @db.Text` | Dirección fiscal completa (admite `\n`) |
| `web` | `String` | URL del sitio web |
| `email` | `String` | Email de contacto del espacio |

**Bloque banca:**

| Campo | Tipo | Reglas / Notas |
|---|---|---|
| `iban` | `String` | IBAN de la cuenta para transferencias |
| `beneficiario_transferencia` | `String` | Nombre del beneficiario en la transferencia |
| `concepto_transferencia` | `String` | Concepto fijo de la transferencia. Regla dura: "espai", nunca "lloguer" |

**Bloque textos:**

| Campo | Tipo | Reglas / Notas |
|---|---|---|
| `plantilla_concepto_fiscal` | `String @db.Text` | Plantilla del concepto fiscal con placeholder `{nombreComercial}`. Misma regla dura: "espai", nunca "lloguer" |
| `validesa_texto` | `String` | Texto de validez del documento (p. ej. "10 DIES") |
| `pie_legal` | `String @db.Text` | Texto del pie legal del documento |

**Bloque condiciones particulars (6.4a):**

| Campo | Tipo | Reglas / Notas |
|---|---|---|
| `condiciones` | `Json @default("{}")` | Contenido del PDF de condicions particulars. Estructura: `{ titulo: string; secciones: Array<{ titulo: string; cuerpo: string }> }`. Valor `{}` o `secciones` vacío = **tenant sin condicions configuradas**; `PdfCondicionesRealAdapter` devuelve `null`. En el flujo E3 (`POST /reservas/{id}/facturas/senal/enviar`) la devolución de `null` es un **requisito bloqueante**: el envío aborta con 409 `CONDICIONES_NO_CONFIGURADAS` (no se degrada a adjunto opcional). En E2 (email de presupuesto, post-commit fire-and-forget) sí se omite el adjunto sin error. Añadido en 6.4a (migración `20260714130000_documento_condiciones_particulares`). Expuesto en el VO `ConfiguracionDocumentoTenant` como tipo `CondicionesDocumento`. |

| Campo | Tipo | Reglas / Notas |
|---|---|---|
| `fecha_creacion` | `DateTime @default(now())` | |
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
| `iban_devolucion` | `String?` | IBAN de devolución de fianza registrado por el gestor, máx. 34. Persistido vía US-035 (UC-26 FA-01, UC-27 pasos 1–3). |
| `activo` | `Boolean @default(true)` | |
| `fecha_creacion` / `fecha_actualizacion` | `DateTime` | Auditoría |

**Regla:** para generar presupuesto/factura (`UC-14`, `UC-18`) son obligatorios `dni_nif`, `direccion`, `codigo_postal`, `poblacion`, `provincia`.

**Registro del IBAN de devolución (US-035 / UC-26 FA-01 / UC-27 pasos 1–3):** el gestor registra en Slotify el IBAN que el cliente le ha proporcionado tras el email E5 (despachado en US-034 al entrar en `post_evento`). El endpoint `PATCH /reservas/{id}/iban-devolucion` con body `{ iban }` es la acción del gestor (JWT de usuario, nunca `X-Cron-Token`), disponible únicamente cuando `RESERVA.estado = post_evento` AND `RESERVA.fianza_eur > 0`. El sistema valida el IBAN mediante **checksum módulo 97** (ISO 13616: normalización, longitud por país, prefijo de país, dígitos de control) como función pura de dominio **antes de toda escritura**; un IBAN inválido devuelve `422` sin tocar `CLIENTE.iban_devolucion` ni disparar E8. Si el IBAN es válido: (1) **Paso transaccional**: `UPDATE CLIENTE SET iban_devolucion = <nuevo>` + `INSERT AUDIT_LOG` (`accion='actualizar'`, `entidad='CLIENTE'`, `datos_anteriores={iban_devolucion:<previo o null>}`, `datos_nuevos={iban_devolucion:<nuevo>}`). Commit. (2) **Paso post-commit (guardar-luego-enviar, D-2)**: el motor de `comunicaciones` (US-045) despacha el email **E8** (confirmación de recepción del IBAN + próximos pasos para la devolución) al `CLIENTE.email` — nunca al gestor — y crea `COMUNICACION` con `codigo_email='E8'`, `reserva_id`, `cliente_id`, `tenant_id`, `estado='enviado'` (o `'fallido'` si el proveedor falla). Un fallo de E8 **no revierte** la actualización de `iban_devolucion` ya commiteada (`COMUNICACION.estado='fallido'` + alerta al gestor: "IBAN guardado, pero E8 no pudo enviarse. Puedes reenviarlo desde la ficha."). **Corrección del IBAN (FA-02):** cada registro/corrección de un IBAN válido sobreescribe `iban_devolucion` y dispara E8. Esta es una **excepción explícita y auditada a la idempotencia** `(reserva_id, codigo_email)` del motor de US-045 (D-3A): por decisión de gate se inserta una **nueva** `COMUNICACION` E8 con `es_reenvio = true` por cada corrección, igual que el reenvío de E4 en US-028 (`design.md §D-3`); al marcarse `es_reenvio = true` la fila queda fuera del predicado del índice UNIQUE parcial `(reserva_id, codigo_email) WHERE reserva_id IS NOT NULL AND es_reenvio = false`, garantizando trazabilidad completa de cada confirmación enviada al cliente. **Precondición dual (FA-04):** si `RESERVA.estado ≠ post_evento` o `RESERVA.fianza_eur = 0` (o `IS NULL`), el backend rechaza la acción con `409` (`estado_no_post_evento` o `sin_fianza`) sin efectos sobre `CLIENTE.iban_devolucion` ni E8. La UI condiciona la visibilidad/habilitación del campo IBAN a `fianza_eur > 0`. La acción se ejecuta bajo RLS del tenant del gestor autenticado (JWT). Sin migración: el campo `ibanDevolucion String? @map("iban_devolucion")` ya existía en el schema Prisma. Fuente: `design.md §D-1..D-6`; `specs/comunicaciones/spec.md`; UC-26/UC-27.

**Alta de consulta (UC-03 / US-003):** a nivel de contrato (DTO/validación de API), `nombre`, `apellidos`, `email` y `telefono` son obligatorios para el alta de lead. En el esquema Prisma siguen siendo nullable para preservar flexibilidad en otras operaciones; la restricción se aplica en la capa interface (class-validator).

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
| `fecha_evento` | `DateTime? @db.Date` | **`> hoy`** (estrictamente futura) cuando se proporciona; opcional en el alta sin fecha (→ sub-estado `2.a`, sin bloqueo). Ver **Nota de divergencia intencional US-004** al final de esta sección. |
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
| `motivo_retencion` | `String? @db.Text` | Motivo de la retención (parcial o total) de fianza. Obligatorio cuando `fianza_devuelta_eur < fianza_eur` (devolución parcial) o cuando el importe devuelto es 0 (retención total). Null en devolución completa. Persiste vía US-036 (`POST /reservas/{id}/fianza/devolucion`). |
| `fecha_post_evento` | `DateTime? @map("fecha_post_evento")` | Timestamp del momento exacto en que la RESERVA entró en el estado `post_evento`. Poblado en la transición `evento_en_curso → post_evento` (US-034) dentro de la misma transacción all-or-nothing. Inmutable una vez fijado: ningún UPDATE posterior lo sobreescribe. El barrido de archivado automático (US-037, `POST /cron/barrido-completadas`) lo usa para calcular la antigüedad T+7d (`date(fecha_post_evento) <= date(hoy) - 7`) de forma fiable, sin depender de `fecha_actualizacion` (`@updatedAt`) que cambia con cualquier UPDATE. Nullable en RESERVA históricas anteriores a la migración. Migración aditiva: `20260710130000_us037_reserva_fecha_post_evento` (columna `fecha_post_evento TIMESTAMPTZ NULL`). |
| `cond_part_firmadas` | `Boolean @default(false)` | `false` cuando el cliente no ha devuelto el contrato firmado. Se fija a `false` al enviar E3 (US-023) y a `true` al registrar la firma (UC-19 flujo registro). Una alerta no bloqueante A29 se emite en T-0 si sigue en `false` (US-031). |
| `cond_part_enviadas_fecha` | `DateTime?` | Timestamp de la última vez que las condicions particulars fueron enviadas al cliente en E3. Fijado en el primer envío (`POST /reservas/{id}/facturas/senal/enviar`, US-023) y actualizado en cada reenvío manual (`POST /reservas/{id}/facturas/senal/reenviar`). `null` si E3 no se ha disparado todavía. |
| `cond_part_firmadas_fecha` | `DateTime?` | Timestamp en que el gestor registra la firma del cliente en el sistema (UC-19 flujo registro). |
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

**Mapeo dominio ↔ Prisma (US-003):** el enum `SubEstadoConsulta` en Prisma no declara `@map`, por lo que los literales almacenados en BD llevan el prefijo `s` (`s2a`, `s2b`… `s2z`), ya que un identificador TypeScript no puede comenzar por dígito. El valor de dominio `'2a'` se traduce a `'s2a'` (y a la inversa) mediante el helper de infraestructura `sub-estado-consulta.mapper.ts`. Es un detalle de persistencia, no un cambio de modelo ni una migración; el concepto de negocio es siempre `'2a'`.

**Generación del `codigo` correlativo (US-003 / UC-03 — patrón retry-on-conflict):** el código de negocio `YY-NNNN` se genera dentro de la `$transaction` del alta mediante `count(*)+1` del tenant. Para resolver la posible colisión entre dos altas concurrentes (que podrían leer el mismo recuento), `UnidadDeTrabajoPrismaAdapter.ejecutar()` implementa **retry-on-conflict**: ante un `P2002` sobre el índice `reserva_codigo_key`, reabre la `$transaction` y reintenta (hasta 3 intentos), re-leyendo el `count` con el ganador ya confirmado. El índice `@unique` sobre `codigo` actúa como red de seguridad final: si se agotan los reintentos, el `P2002` se propaga al `HttpExceptionFilter` global → **409 Conflict**. El controlador no enmascara ningún error como 500.

**Guarda de transición a `evento_en_curso`:** `pre_evento_status = cerrado AND liquidacion_status = cobrada AND fianza_status = cobrada`.

**Transición `evento_en_curso → post_evento` (US-034 / UC-25 — sin migración):** acción **manual del gestor** que cierra la ejecución del evento. La guarda de origen declarativa (`MAPA_FINALIZACION_EVENTO` + `resolverFinalizacionEvento` en `maquina-estados.ts`) admite un único origen: `estado = 'evento_en_curso'`; cualquier otro estado produce 409 (`transicion_no_permitida`) sin efectos. La transición es **irreversible**: no existe arista de retorno `post_evento → evento_en_curso` en la máquina de estados. La acción se autentica con **JWT de usuario** (rol gestor, RLS del tenant del JWT — nunca `X-Cron-Token`, que es exclusivo de barridos de Sistema). El flujo implementa **dos operaciones separadas** (design.md §D-2): (1) **Paso transaccional** bajo `SELECT … FOR UPDATE` de la fila RESERVA: re-evalúa la guarda de origen, fija `RESERVA.estado = post_evento`, escribe `AUDIT_LOG` con `accion='transicion'`, `datos_anteriores={estado:evento_en_curso}`, `datos_nuevos={estado:post_evento}` y `usuario_id` del gestor (origen **Usuario** — contraste con US-031 donde el origen es Sistema); marca la NPS como programada (T+3d, marca derivada sin campo nuevo, D-6); si `fianza_status='cobrada'` AND `fianza_eur IS NULL` (dato inconsistente), registra alerta de dato anómalo en `AUDIT_LOG`. (2) **Paso post-commit (best-effort):** si `debeEnviarseE5(fianza_eur)` (`fianza_eur != null && fianza_eur > 0`), invoca el motor de email de `comunicaciones` (US-045, puerto `DispararE5Port`) con el trigger E5 hacia `CLIENTE.email`; crea `COMUNICACION` con `codigo_email='E5'`, `reserva_id`, `cliente_id`, `tenant_id`, `estado='enviado'` (o `'fallido'` si el proveedor falla); un fallo de E5 **no revierte** la transición ya commiteada (`COMUNICACION.estado='fallido'` + alerta al gestor). Si `fianza_eur = 0` o `IS NULL`, no se envía E5 ni se crea `COMUNICACION` para E5. La concurrencia de doble finalización se resuelve por el `SELECT … FOR UPDATE`: la segunda petición observa `estado ≠ evento_en_curso` (0 filas afectadas) y termina como conflicto, sin doble transición, sin doble `AUDIT_LOG` y sin doble E5. Sin migración: `estado`, `fianza_eur`, `fianza_status`, `COMUNICACION` y `AUDIT_LOG` ya existían en el modelo. Fuente: `design.md §D-1..D-9`; `specs/consultas/spec.md`; `specs/comunicaciones/spec.md`; UC-25.

**Archivado automático a `reserva_completada` en T+7d (US-037 / UC-28 — migración aditiva `20260710130000_us037_reserva_fecha_post_evento`):** el Sistema archiva automáticamente la RESERVA cuando lleva ≥ 7 días naturales en `post_evento` y la fianza está resuelta. La transición `post_evento → reserva_completada` es **terminal e inmutable**: no existe arista de salida. La guarda de fianza resuelta evalúa `fianza_status ∈ {devuelta, retenida_parcial}` OR `fianza_eur <= 0` OR `fianza_eur IS NULL`; `retenida_parcial` con `fianza_devuelta_eur = 0` (retención total) es un estado resuelto válido. El barrido periódico protegido (`POST /cron/barrido-completadas`, `X-Cron-Token`, `CronTokenGuard`) selecciona candidatas con `estado = 'post_evento'` AND `date(fecha_post_evento) <= date(hoy) - 7`, transiciona cada elegible en una **transacción atómica** bajo RLS del tenant (`SELECT … FOR UPDATE` + re-evaluación de ambas guardas bajo el lock) y registra en `AUDIT_LOG` (`accion='transicion'`, `entidad='RESERVA'`, `datos_anteriores={estado:post_evento}`, `datos_nuevos={estado:reserva_completada, causa:'T+7d'}`, `usuario_id` nulo — origen Sistema). El barrido es **idempotente**: una RESERVA ya en `reserva_completada` no es candidata (el filtro `estado='post_evento'` la excluye); N ejecuciones producen 1 sola transición y 1 sola entrada en `AUDIT_LOG`. La concurrencia cron (US-037) vs archivado manual (US-038) se resuelve por el lock de fila: la segunda operación observa `estado ≠ post_evento` (0 filas afectadas) y termina como no-op sin error, sin doble auditoría. El fallo de una transición no aborta ni revierte las demás candidatas (fallo aislado por RESERVA). La respuesta del barrido resume `{ candidatas, archivadas, fianzaPendiente, fallos }`. **Alerta FA-01 (fianza pendiente en T+7d):** si la guarda de fianza no se satisface, la RESERVA permanece en `post_evento` y el Sistema registra en `AUDIT_LOG` una entrada de alerta (`accion='actualizar'`, `datos_nuevos.tipo='fianza_pendiente_t7d'`, `usuario_id` nulo) sin transicionar; la anti-duplicación se aplica mediante idempotencia por `AUDIT_LOG` (Opción 4.2 aprobada en gate: antes de emitir, se verifica que no existe ya una entrada `fianza_pendiente_t7d` posterior al último cambio de `fianza_status`). La transición y la alerta viven en `maquina-estados.ts` como tabla declarativa `MAPA_ARCHIVADO_AUTOMATICO` (arista `post_evento → reserva_completada`, terminal) y guarda pura `fianzaResuelta()`, sin `if` dispersos. Requiere que US-034 pueble `RESERVA.fecha_post_evento` en la misma transacción de finalización del evento; las RESERVA migradas sin ese campo usan `NULL` como señal de "antigüedad desconocida" (no son candidatas hasta que la fecha quede fijada). Fuente: `design.md §D-1..D-8`; `specs/consultas/spec.md`; UC-28; US-036 (guarda de fianza).

**Registro de la devolución de fianza (US-036 / UC-27 pasos 4–8 — migración aditiva `20260710120000_us036_reserva_motivo_retencion`):** acción **manual del gestor** disponible únicamente cuando `RESERVA.estado = post_evento` AND `RESERVA.fianza_status = cobrada`. Registra la devolución efectiva de la fianza en tres modalidades:

- **Devolución completa** (`fianza_devuelta_eur = fianza_eur`): `fianza_status → 'devuelta'`, `motivo_retencion` permanece `NULL`.
- **Devolución parcial** (`0 < fianza_devuelta_eur < fianza_eur`): `fianza_status → 'retenida_parcial'`, `motivo_retencion` **obligatorio** (400 `MOTIVO_RETENCION_REQUERIDO` si ausente).
- **Retención total** (`fianza_devuelta_eur = 0`): `fianza_status → 'retenida_parcial'`, `motivo_retencion` **obligatorio**.

La validación previa a la transacción verifica: `fianza_devuelta_eur ≤ fianza_eur` (400 `IMPORTE_SUPERA_FIANZA`), `fecha_devolucion ≤ hoy` (400 `FECHA_DEVOLUCION_INVALIDA`), `justificante_doc_id` si se proporciona debe existir en DOCUMENTO (404 `JUSTIFICANTE_NO_ENCONTRADO`). La guarda de concurrencia usa `SELECT … FOR UPDATE` sobre la fila de RESERVA; si `fianza_status ≠ 'cobrada'` al abrir la transacción, el sistema rechaza con 409 `PRECONDICION_NO_CUMPLIDA`; si la devolución ya fue registrada (`fianza_status ∈ {devuelta, retenida_parcial}`), devuelve 409 `DEVOLUCION_YA_REGISTRADA`. La operación es **irreversible**. En una única transacción all-or-nothing: (1) UPDATE de RESERVA (`fianza_status`, `fianza_devuelta_fecha`, `fianza_devuelta_eur`, `motivo_retencion`); (2) INSERT en AUDIT_LOG (`accion='actualizar'`, `entidad='RESERVA'`, `datos_anteriores={fianza_status:'cobrada'}`, `datos_nuevos={fianza_status, fianza_devuelta_fecha, fianza_devuelta_eur, motivo_retencion}`); (3) si se adjunta justificante, INSERT en DOCUMENTO(`tipo=justificante_pago`). El justificante debe haberse subido previamente vía `POST /documentos` y referenciarse por su `id_documento`. Migración: `20260710120000_us036_reserva_motivo_retencion` — añade `motivo_retencion TEXT NULL` de forma aditiva, sin romper las rutas existentes. Fuente: UC-27 pasos 4–8; `docs/api-spec.yml` operationId `registrarDevolucionFianza`.

**Transición {2a,2b,2c} → 2.v (US-008 / UC-07 — sin migración):** el Gestor programa una visita sobre una RESERVA existente en `sub_estado ∈ {'2a','2b','2c'}`. El use-case (`programar-visita.use-case.ts`) valida la guarda de origen declarativa (`ORIGENES_TRANSICION_PROGRAMAR_VISITA = {2a,2b,2c}` en `maquina-estados.ts`) y la ventana de fecha (`fecha_visita ∈ [hoy+1, hoy+TENANT_SETTINGS.max_dias_programar_visita]`), leyendo el setting del tenant. Para `2a`, exige adicionalmente `fecha_evento IS NOT NULL` (la fecha del evento debe estar fijada antes de la visita). En una única transacción all-or-nothing serializada por `SELECT … FOR UPDATE` sobre la fila bloqueante de `FECHA_BLOQUEADA`: (1) UPDATE de la RESERVA (`sub_estado='2v'`, `visita_programada_fecha`, `visita_programada_hora`, `visita_realizada=false`); (2) INSERT-o-UPDATE (upsert) de `FECHA_BLOQUEADA` con `ttl_expiracion = visita_programada_fecha + 1 día (23:59:59)` y `tipo_bloqueo='blando'` — si el origen era `2b`/`2c` (ya tenía fila activa) se actualiza el TTL de la fila existente, si era `2a` sin bloqueo se crea una nueva fila; la garantía `UNIQUE(tenant_id, fecha)` serializa la creación concurrente; (3) `AUDIT_LOG accion='transicion'` con `datos_anteriores.sub_estado` (origen) y `datos_nuevos.sub_estado='2v'`, `datos_nuevos.visita_programada_fecha`. Post-commit (no bloqueante): dispara E6 vía el motor de email de US-045 y registra en `COMUNICACION`. Una RESERVA con `sub_estado='2d'` recibe rechazo con mensaje UC-12 (409); los terminales (`2x`/`2y`/`2z`/`reserva_cancelada`/`reserva_completada`) son inmutables (422). Sin migración: `visita_programada_fecha` (DATE), `visita_programada_hora` (TIME), `visita_realizada` (BOOLEAN), el valor de enum `2v` (`s2v` en Prisma) y `TENANT_SETTINGS.max_dias_programar_visita` (INT, default 7) existen en el modelo desde US-000. Fuente: `design.md §D-1..D-9`, `specs/consultas/spec.md`.

**Transición {2a,2b,2c,2v} → pre_reserva (US-014 / UC-14 — sin migración):** el Gestor genera el presupuesto formal cuando todos los datos del cliente y la reserva están completos. La guarda de origen declarativa (`ORIGENES_TRANSICION_ACTIVAR_PRERESERVA`) acepta `{2a,2b,2c,2v}` y rechaza `2d`, terminales y estados `pre_reserva` o posteriores (409/422 sin efectos). El use-case exige datos fiscales del CLIENTE (`dni_nif`, `direccion`, `codigo_postal`, `poblacion`, `provincia`); si faltan, devuelve 422 con `camposFaltantes[]`. En una única transacción all-or-nothing serializada por `SELECT … FOR UPDATE` sobre la fila de `FECHA_BLOQUEADA`: (1) INSERT en PRESUPUESTO (`version = 1`, `tarifa_congelada = true`, `estado = 'enviado'`, `iva_porcentaje = 21`); (2) UPDATE de RESERVA (`estado = 'pre_reserva'`, `sub_estado = NULL`, `ttl_expiracion = now() + ttl_prereserva_dias`); (3) insert-o-update de `FECHA_BLOQUEADA` — UPDATE si el origen tenía fila (`2b`/`2c`/`2v`), INSERT si venía de `2a`; (4) vaciado cola A16: UPDATE masivo `2d → 2y`, `posicion_cola = NULL`, `consulta_bloqueante_id = NULL`; (5) `AUDIT_LOG accion='transicion'` para RESERVA principal y cada descartada. Post-commit: PDF vía Puppeteer/react-pdf + UPDATE de `PRESUPUESTO.pdf_url`; E2 vía motor US-045. Fallo de PDF o email no revierte la pre-reserva. Responde 201. Sin migración (PRESUPUESTO ya existía en el modelo desde US-000; `fecha_envio` y `fecha_actualizacion` ya presentes en BD). Fuente: `design.md §D-1..D-9`; UC-14.

**Transición 2.v → pre_reserva "reserva inmediata" (US-010 / UC-08 FA-08 — sin migración):** el Gestor registra el resultado de visita "el cliente quiere reservar ahora". Esta transición comparte el destino `pre_reserva` de UC-14 pero lo alcanza directamente desde `2.v`, sin generar presupuesto ni disparar email. La guarda de origen declarativa (`esOrigenValidoParaResultadoVisitaReservaInmediata`, tabla `ORIGENES_TRANSICION_RESULTADO_VISITA_RESERVA_INMEDIATA = [{consulta, 2v}]` en `maquina-estados.ts`) exige `sub_estado = '2v'`; cualquier otro sub-estado o estado terminal produce 422 sin efectos. Antes de abrir la transacción, el use-case valida los **datos obligatorios UC-14** reutilizando el patrón `CampoFiscalFaltante` de UC-14: RESERVA (`fecha_evento`, `duracion_horas`, `tipo_evento`, `num_adultos_ninos_mayores4`) y CLIENTE (`dni_nif`, `direccion`, `codigo_postal`, `poblacion`, `provincia`); si falta alguno → 422 con `camposFaltantes[]`, RESERVA intacta en `2v`, sin ninguna mutación. En una única transacción all-or-nothing serializada por `SELECT … FOR UPDATE` sobre la fila bloqueante de `FECHA_BLOQUEADA`: (1) UPDATE de RESERVA (`estado='pre_reserva'`, `sub_estado=NULL`, `visita_realizada=true`, `ttl_expiracion = now() + TENANT_SETTINGS.ttl_prereserva_dias`); (2) UPDATE de `FECHA_BLOQUEADA.ttl_expiracion` al mismo valor, `tipo_bloqueo` permanece `'blando'` — la fila siempre existe al venir de `2.v`, por lo que es un **UPDATE puro sin rama de INSERT** (a diferencia de UC-14 que puede hacer INSERT desde `2a`); (3) vaciado cola A16 reutilizando el patrón `ColaPrereservaPrismaRepository.vaciar` de UC-14: todas las RESERVA con `consulta_bloqueante_id = esta_reserva` y `sub_estado = '2d'` pasan a `sub_estado='2y'`, `posicion_cola=NULL`, `consulta_bloqueante_id=NULL` (válido con 0 filas); (4) `AUDIT_LOG accion='transicion'` para la RESERVA principal y para cada consulta vaciada de la cola. No se dispara ningún email (E2 se delega a UC-14 al generar el presupuesto). El TTL es **fresco**: `now() + ttl_prereserva_dias` (7 días, leído del setting, nunca hardcodeado), independiente del TTL anterior (`2.v`). Diferencias clave respecto de US-009: destino es `pre_reserva` (cambia `estado`, no solo `sub_estado`), `sub_estado` pasa a NULL, TTL usa `ttl_prereserva_dias`, requiere validación de datos obligatorios y vacía la cola A16 atómicamente. Sin migración (todos los campos ya existían desde US-000/US-008/US-014). Fuente: US-010; UC-08 FA-08; UC-14.

**Transición 2.a → 2.b/2.d (US-005 / UC-04):** el Gestor añade una `fecha_evento` a una RESERVA **existente** en `sub_estado = '2a'` (consulta exploratoria). La transición muta la RESERVA existente (UPDATE, no INSERT): actualiza `sub_estado`, `fecha_evento` y `ttl_expiracion`. Los campos `posicion_cola` y `consulta_bloqueante_id` (ya presentes en el modelo desde US-004) se escriben cuando la RESERVA pasa a `2d`. No se requirió ninguna migración de columnas ni índices: toda la estructura de cola y bloqueo existía desde US-000/US-040/US-004. El campo `ttl_expiracion` de la RESERVA se fija como `now() + TENANT_SETTINGS.ttl_consulta_dias` cuando la transición es `2a → 2b`; permanece nulo si la RESERVA entra en cola (`2d`). El `AUDIT_LOG` registra `accion='transicion'`, `datos_anteriores.sub_estado='2a'`, `datos_nuevos.sub_estado='2b'/'2d'` y `datos_nuevos.fecha_evento` en la misma transacción. El detalle de la RESERVA se expone vía `GET /reservas/{id}` (implementado en este change, FIX 3), que devuelve la forma `ReservaDetalle` con el objeto `cliente` incrustado. Fuente: `design.md §D-1..D-8`, `specs/consultas/spec.md`.

**Divergencia intencional US-004/US-005 — validación de fecha (Gate 1 US-004, decisión A; Gate SDD US-005, resolución `> hoy`):** la ficha US-004 admitía `fecha_evento ≥ hoy` (incluyendo el día de hoy). La implementación adopta `fecha_evento > hoy` (estrictamente futura): el servidor rechaza `fecha_evento = hoy` y cualquier fecha pasada con error **400** sin crear `RESERVA` ni `FECHA_BLOQUEADA`. Motivo: alinear la rama de alta con fecha con la primitiva `validarFechaFutura` existente (US-040), el motor de tarifa (US-016) y el bloqueo atómico, manteniendo **una única regla de "fecha válida"** en todo el sistema. La misma regla se aplica a la transición `2a→2b/2d` (US-005): la ficha US-005 admitía `≥ hoy`, pero la resolución del Gate SDD (29/06/2026) adoptó `> hoy` para unificar con la primitiva `esFechaEstrictamenteFutura` reutilizada. La UI impide seleccionar hoy y fechas pasadas (`min = mañana`). Trazabilidad US-004: `openspec/changes/us-004-alta-consulta-con-fecha/design.md §D-1`. Trazabilidad US-005: `openspec/changes/2026-06-29-us-005-transicion-exploratoria-a-con-fecha/design.md §D-1`.

**Alta con fecha: lógica declarativa en la máquina de estados (US-004 / D-3):** la determinación del sub-estado de alta (`2b` / `2d` / `2a`) se resuelve mediante la función declarativa `determinarAltaConFecha(estadoFecha)` en `maquina-estados.ts`, que consulta una **tabla de datos** (no condicionales dispersos). Los estados `EstadoFecha` considerados son: `libre` → `{ subEstado: '2b', accion: 'bloquear' }`; `bloqueada-por-2b` → `{ subEstado: '2d', accion: 'encolar' }`; `bloqueada-por-2c|2v|pre|conf+` → `{ subEstado: '2a', accion: 'exploratoria' }`. Las entradas iniciales `2b` y `2d` se añadieron a `ENTRADAS_INICIALES` para que `esEntradaInicialValida` las acepte. La función se evalúa **dentro del cuerpo transaccional reintentado** para garantizar que ante una colisión `UNIQUE(tenant_id, fecha)` (D4), el reintento re-deriva el sub-estado con el estado ya actualizado. Fuente: `design.md §D-3`, `design.md §D-6`.

**Reutilización en la transición 2.a → 2.b/2.d (US-005 / D-3):** `determinarAltaConFecha` también se reutiliza en el use-case de transición de US-005 (`transicion-fecha.use-case.ts`). En la transición el resultado `accion: 'sin-cambios'` significa **permanecer en `2.a`** (la RESERVA ya estaba en `2.a`), a diferencia del alta donde significaba crear una exploratoria. Una sola fuente de verdad para alta (US-004) y transición (US-005). La guarda de origen se modela como la tabla declarativa `ORIGENES_TRANSICION_ANADIR_FECHA` + la función `esOrigenValidoParaAnadirFecha` en `maquina-estados.ts`: solo `{consulta, 2a}` es origen legal; cualquier otro estado/sub-estado produce rechazo inmediato con error de validación (422) sin mutar la RESERVA. Fuente: `design.md §D-3`.

**Reuso de `bloquearFecha()` en la misma transacción (US-004 / D-2 — reutilizado por US-005 / D-4):** el bloqueo blando de `2.b` se inserta en la **misma transacción** que muta la RESERVA, reutilizando `bloquearEnTx(tx, …)` — método interno de `FechaBloqueadaPrismaAdapter` que acepta el cliente transaccional Prisma. El método público `bloquear()` (US-040) permanece intacto como wrapper que abre su propia `$transaction` y delega en `bloquearEnTx`; el contrato externo de US-040 no cambia (cero regresión). En el alta (US-004), la transacción crea la RESERVA (INSERT) + FECHA_BLOQUEADA (INSERT). En la transición (US-005), la transacción actualiza la RESERVA existente (UPDATE de `sub_estado`/`fecha_evento`/`ttl_expiracion`) + inserta la FECHA_BLOQUEADA: all-or-nothing en ambos casos. Fuente US-004: `design.md §D-2`. Fuente US-005: `design.md §D-4`.

**Puerto `TarifaEstimadaPort` (US-004 / D-4):** nuevo puerto de dominio en `reservas/domain/` que envuelve `CalculadoraTarifaService.calcular(…)` (US-016). Se invoca solo si el alta incluye `fecha_evento` + `num_adultos_ninos_mayores4` + `duracion_horas`; si falta alguno de esos campos, E1 sale con el dossier general sin precio. Tolerante a errores: `TEMPORADA_NO_CONFIGURADA`, `TARIFA_NO_CONFIGURADA` y `tarifa_a_consultar = true` se degradan silenciosamente a "E1 sin precio" sin bloquear el alta. La tarifa estimada **no se persiste** en `RESERVA` (es decorativa de E1). Fuente: `design.md §D-4`.

**Transición {2a,2b,2c,2d,2v} → 2z — descarte por cliente (US-013 / UC-10 — sin migración):** el Gestor marca una RESERVA en `estado = 'consulta'` con `sub_estado ∈ {2a,2b,2c,2d,2v}` como descartada por cliente, transicionándola a `sub_estado = '2z'` (terminal inmutable, variante manual de A17). La guarda de origen declarativa (`ORIGENES_TRANSICION_DESCARTAR_POR_CLIENTE` en `maquina-estados.ts`) acepta únicamente sub-estados no terminales del estado `consulta`; cualquier sub-estado terminal (`2x`/`2y`/`2z`) o estado no consulta (`reserva_cancelada`/`reserva_completada`/etc.) produce 409 sin efectos. Los efectos secundarios se modelan como **tabla declarativa indexada por sub-estado de origen** (no condicionales dispersos), garantizando atomicidad all-or-nothing dentro de una única transacción serializada por `SELECT … FOR UPDATE` sobre `FECHA_BLOQUEADA` (cuando el origen tiene bloqueo) y/o la RESERVA:
- **Origen `2a`**: solo UPDATE de RESERVA (`sub_estado='2z'`). No hay fila en `FECHA_BLOQUEADA` ni cola que tocar.
- **Origen `2b`/`2c`/`2v`**: UPDATE RESERVA + `liberarFecha()` (DELETE idempotente de `FECHA_BLOQUEADA`, causa `descarte`); si el origen era `2b` o `2v` y existía cola activa, dispara `PromocionColaPort.promoverPrimeroEnCola({ tenantId, fecha })` **exactamente una vez** (seam A15, mecánica UC-12 / US-018); si la cola estaba vacía o el origen era `2c`, la operación termina sin promoción (no-op válido). La auditoría de `liberarFecha()` (entidad `FECHA_BLOQUEADA`, causa `descarte`) y la de la promoción las registran sus propios seams; esta transición no las duplica.
- **Origen `2d`**: UPDATE RESERVA (`sub_estado='2z'`, `posicion_cola=NULL`, `consulta_bloqueante_id=NULL`) + UPDATE masivo de `posicion_cola−1` sobre todas las RESERVA en `2d` con el mismo `consulta_bloqueante_id` y `posicion_cola > P` (cierre de hueco, preservando `UNIQUE(tenant_id, consulta_bloqueante_id, posicion_cola) WHERE posicion_cola IS NOT NULL`). La bloqueante no se modifica; no se libera `FECHA_BLOQUEADA`.
- **Motivo opcional**: si el Gestor proporciona `motivo`, se **anexa** a `RESERVA.notas` (`notas_previas + "\n[descarte cliente] " + motivo`); la ausencia de motivo no bloquea la transición y no modifica `notas`.
- **AUDIT_LOG**: `accion='transicion'`, `entidad='RESERVA'`, `datos_anteriores.sub_estado=<origen>`, `datos_nuevos.sub_estado='2z'`. Para el origen `2d`, `datos_nuevos` también incluye `posicion_cola=NULL` y `consulta_bloqueante_id=NULL` (coherente con el criterio de US-014/US-018 para salidas de cola).
- **Sin email**: la transición a `2z` no activa ningún código E1–E8 del catálogo de comunicaciones.
- **Terminales semánticamente distintos**: `2z` (descarte por cliente, esta US), `2y` (descarte por cola, US-014/A16), `2x` (expiración por TTL, US-012/A21). No colapsar.
- **Sin migración**: `sub_estado = '2z'` (`s2z` en Prisma), `notas`, `posicion_cola`, `consulta_bloqueante_id` y `AUDIT_LOG` existen desde US-000/US-004. La lógica de `liberarFecha()` y `PromocionColaPort` ya existía en US-041/US-018.
- Endpoint: `POST /reservas/{id}/descartar` — body `{ motivo?: string }` (operationId `descartarConsultaPorCliente`). Fuente: `design.md §D-1..D-6`; `specs/consultas/spec.md`; UC-10; A17.

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
| `2.v` | `blando` | `visita_programada_fecha + 1 día` | insert-o-update |
| `pre_reserva` | `blando` | `now() + TENANT_SETTINGS.ttl_prereserva_dias` (7 d por defecto) | insert-o-update |
| `reserva_confirmada` | `firme` | `NULL` | upgrade |

**Nota US-014 — modo `insert-o-update` para `fase 'pre_reserva'`:** la transición `{2a,2b,2c,2v} → pre_reserva` (UC-14) puede llegar desde orígenes que ya tenían fila activa en `FECHA_BLOQUEADA` (`2b`, `2c`, `2v`) o desde `2a` que no la tenía. Cuando el origen tenía fila, la operación hace **UPDATE** del `ttl_expiracion` de la fila existente sin crear una segunda fila (la restricción `UNIQUE(tenant_id, fecha)` lo impediría); cuando el origen era `2a` sin bloqueo previo, hace **INSERT** de una nueva fila. En la práctica se implementa como upsert atómico dentro de la misma transacción que la mutación de RESERVA y el INSERT de PRESUPUESTO. El TTL deriva de `TENANT_SETTINGS.ttl_prereserva_dias` (7 días por defecto, nunca hardcodeado). Fuente: `design.md §D-3`; UC-14; US-014.

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

**Primera persistencia real — US-015 (D3, aprobado gate 2026-07-15):** US-014 nunca persistió filas de `ReservaExtra` (los extras del preview/confirmar se pasaban solo al motor de tarifa para el cálculo). **US-015 es la primera historia que crea líneas `ReservaExtra` reales** al confirmar la edición del presupuesto en `pre_reserva`. Las líneas se ligan a la `Reserva` (conjunto vivo; sin FK a `Presupuesto`); el dato fiscal firme por versión lo proporciona el desglose congelado (`base_imponible`/`total`) del `Presupuesto`. Las líneas añadidas en UC-15 usan `origen = 'anadido_post_confirmacion'` y `factura_id = null`. Las líneas **existentes** conservan su `precio_unitario` congelado aunque el catálogo cambie; solo las líneas **nuevas** añadidas en esa edición toman el precio actual del catálogo.

| Campo | Tipo | Reglas / Notas |
|---|---|---|
| `id_reserva_extra` | `String @id @default(uuid())` | |
| `reserva_id` | `String` | FK → `Reserva` |
| `extra_id` | `String?` | FK → `Extra`. Nulo si extra fuera de catálogo (`concepto_libre` en su lugar) |
| `factura_id` | `String?` | FK → `Factura` donde se cobra. `null` mientras no facturado; se asigna al emitir la factura de liquidación (US-028) o complementaria |
| `concepto_libre` | `String?` | Descripción manual para extras fuera de catálogo |
| `origen` | `OrigenExtra` | `presupuesto \| anadido_post_confirmacion`. UC-15 usa `anadido_post_confirmacion` para todas las líneas añadidas en la edición |
| `cantidad` | `Int` | `>= 1`. Modificar la cantidad de una línea existente recalcula `subtotal` sin cambiar `precio_unitario` |
| `precio_unitario` | `Decimal @db.Decimal(10,2)` | Congelado al añadir la línea. Inmune a cambios posteriores del catálogo. En UC-15, líneas **nuevas** toman el `precio_eur` actual del `Extra`; líneas **existentes** conservan su valor congelado |
| `subtotal` | `Decimal @db.Decimal(10,2)` | `cantidad × precio_unitario` |
| `fecha_creacion` | `DateTime @default(now())` | |

**Regla de facturación:** las líneas con `factura_id IS NULL` se asignan a la factura de liquidación (T-1d); si la petición llega después de emitida la liquidación, a una factura `complementaria` en post-evento.

### 3.11 Presupuesto
Versiones del presupuesto generado para una reserva (UC-14 / US-014; edición en UC-15 / US-015). Cada versión congela el desglose fiscal derivado del motor de tarifa en el momento de la confirmación. La primera versión (`version = 1`) se crea en la misma transacción que la transición de la RESERVA a `pre_reserva`. Versiones posteriores corresponden a ediciones del presupuesto en `pre_reserva` (UC-15 / US-015).

La restricción `@@unique([reserva_id, version])` garantiza que no existan dos presupuestos con la misma versión para la misma reserva.

**Versionado inmutable — US-015 (D2, aprobado gate 2026-07-15):**
- Cada edición confirmada (UC-15) crea una **fila nueva** con `version = MAX(version)+1`; las versiones anteriores persisten como historial (no se borran ni sobrescriben).
- El **presupuesto vigente** es el de mayor `version` (se deriva por `MAX`, sin campo `es_vigente`).
- Cada **envío de una versión nueva** consume un `numero_presupuesto = AAAANNN` de la secuencia del régimen (reintento `P2002`). Un **borrador** queda con `numero_presupuesto = null` hasta enviarlo.
- El **reenvío sin cambios** (UC-15 flujo B) no crea versión nueva ni consume número; solo registra `COMUNICACION E2 es_reenvio=true` + `AUDIT_LOG`.

**RLS y `tenant_id`:** el campo `tenant_id` se añadió en 6.1b (con backfill desde `RESERVA`). El aislamiento efectivo sigue siendo la policy RLS preexistente por subconsulta a `RESERVA`. El `tenant_id` en la tabla sirve para soporte de la restricción de unicidad de numeración y no origina una nueva policy (ni en 6.1b ni en 6.2).

**Método de pago y régimen fiscal (6.2):** al generar el presupuesto el gestor elige el `metodoPago` (`transferencia` / `efectivo`), obligatorio tanto en el preview como en la confirmación. La función de dominio pura `regimenDesdeMetodoPago` (mapa declarativo en `presupuestos/domain/`) deriva el régimen: `transferencia ⇒ con_iva`, `efectivo ⇒ sin_iva`. Ambos campos se persisten en `Presupuesto`. Las filas de 6.1b reciben backfill `metodo_pago = 'transferencia'` / `regimen_iva = 'con_iva'`.

**Cálculo fiscal por régimen (6.2):** `calcularDesgloseFiscal` y `calcularReparto` son funciones de dominio puras que reciben `RegimenIva` y ramifican de forma declarativa. La base imponible es la MISMA en ambos regímenes (derivada del motor de tarifa menos descuento, dividida entre 1.21). En CON IVA el total suma el 21%; en SIN IVA el total es la base (importe menor, sin el 21%). El reparto 40/60 se calcula sobre el total del régimen; la fiança es fija del setting del tenant e igual en ambos. Los importes congelados reflejan el régimen del presupuesto.

**Doble numeración por régimen (6.2):** dos secuencias independientes por `(tenantId, año, regimenIva)`. El literal `AAAANNN` (p. ej. `2026001`) es compartido entre CON y SIN; la unicidad se garantiza por `@@unique([tenantId, regimenIva, numeroPresupuesto])` (sustituye al `@@unique([tenantId, numeroPresupuesto])` de 6.1b). Los presupuestos de 6.1b (backfill `regimen_iva = 'con_iva'`) son la secuencia CON y continúan sin discontinuidad. El reintento `P2002` discrimina por `meta.target` para no confundirlo con el `P2002` de `FECHA_BLOQUEADA`. Las facturas conservan su numeración `F-YYYY-NNNN`; su migración a doble secuencia es la rebanada 6.3.

**Nota de implementación — `tarifa_id` ausente del schema (US-014/US-015):** el design D-5 preveía almacenar `tarifa_id` como referencia trazable a la `TARIFA` vigente usada. En la implementación se confirmó que el motor de tarifa (US-016) devuelve `tarifa_id` en su esquema canónico, pero la columna no se añadió al modelo de `Presupuesto` en US-014 ni en US-015; la referencia a la tarifa queda en el `AUDIT_LOG`. Deuda técnica pendiente de una historia de trazabilidad dedicada.

| Campo | Tipo | Reglas / Notas |
|---|---|---|
| `id_presupuesto` | `String @id @default(uuid())` | |
| `reserva_id` | `String` | FK → `Reserva` |
| `tenant_id` | `String` | FK → `Tenant`. Añadido en 6.1b. Backfill desde `Reserva`. Solo para la restricción de unicidad de numeración; el aislamiento RLS lo aplica la policy preexistente por subconsulta a `Reserva`. |
| `metodo_pago` | `MetodoPago?` | enum `transferencia \| efectivo`. Nullable en BD (migración aditiva 6.2); backfill a `transferencia` para filas de 6.1b. Nunca null en filas nuevas. `@map("metodo_pago")` |
| `regimen_iva` | `RegimenIva?` | enum `con_iva \| sin_iva`. Derivado de `metodo_pago` por `regimenDesdeMetodoPago`. Nullable en BD (migración aditiva 6.2); backfill a `con_iva` para filas de 6.1b. Nunca null en filas nuevas. `@map("regimen_iva")` |
| `numero_presupuesto` | `String?` | Formato `AAAANNN` (p. ej. `2026001`). Nullable en borradores (UC-15 borrador sin enviar); asignado en la tx de confirmación/envío con reintento `P2002`. Restricción `@@unique([tenantId, regimenIva, numeroPresupuesto])` (6.2). El reenvío sin cambios (UC-15 flujo B) reutiliza el número existente sin consumir uno nuevo. |
| `version` | `Int` | 1, 2, 3… `version=1` creado por UC-14; versiones sucesivas por UC-15. Restricción `@@unique([reserva_id, version])`. |
| `base_imponible` | `Decimal @db.Decimal(10,2)` | Base imponible antes de IVA. MISMA en ambos regímenes. Derivada: `(totalConIva − descuento) / 1.21` |
| `iva_porcentaje` | `Decimal @db.Decimal(4,2)` | 21.00 en régimen CON IVA; 0.00 en régimen SIN IVA |
| `iva_importe` | `Decimal @db.Decimal(10,2)` | Importe de IVA. `total − base` en CON IVA; 0.00 en SIN IVA |
| `total` | `Decimal @db.Decimal(10,2)` | Total según régimen. CON IVA: `base + IVA21`. SIN IVA: `base` (importe menor). |
| `descuento_eur` | `Decimal? @db.Decimal(10,2)` | Descuento aplicado por el Gestor. Nullable. En UC-15: `descuento_eur ≥ 0` y `≤ base_imponible` (total nunca negativo). |
| `descuento_motivo` | `String?` | Motivo del descuento. Nullable |
| `tarifa_congelada` | `Boolean @default(true)` | Una vez confirmada la versión, un cambio del tarifario no la recalcula. Las versiones de UC-15 heredan este comportamiento. |
| `pdf_url` | `String?` | URL del PDF generado post-commit (react-pdf). Nullable hasta que se genera. Cada versión de UC-15 regenera su propio PDF post-commit; el reenvío sin cambios reutiliza el `pdf_url` de la versión vigente. |
| `estado` | `EstadoPresupuesto` | `borrador \| enviado \| aceptado \| rechazado`. UC-14 crea siempre `enviado`; UC-15 crea `enviado` (con envío) o `borrador` (sin envío). |
| `fecha_envio` | `DateTime?` | No nulo solo cuando `estado = 'enviado'`. Nulo en `borrador`, `aceptado` y `rechazado` |
| `fecha_creacion` / `fecha_actualizacion` | `DateTime` | |

**Flujo de creación en UC-14 (US-014) — actualizado en 6.2:**
1. El Gestor elige el `metodoPago` y revisa el borrador (calculado por `POST /reservas/{id}/presupuesto/preview` con `metodoPago` obligatorio — sin persistencia). El importe del borrador refleja el régimen (CON IVA o SIN IVA).
2. Al confirmar (`POST /reservas/{id}/presupuesto`), en **una única transacción**: se deriva el `regimenIva`, se calcula el desglose fiscal y el reparto según el régimen; INSERT en PRESUPUESTO con `version = 1`, `tarifa_congelada = true`, `estado = 'enviado'`, `metodoPago`, `regimenIva`; UPDATE de RESERVA a `pre_reserva`; insert-o-update del bloqueo en `FECHA_BLOQUEADA` a `now() + ttl_prereserva_dias`; vaciado cola A16 (`2d → 2y`); INSERT `AUDIT_LOG`.
3. Post-commit: generación del PDF en la variante del régimen + UPDATE de `pdf_url` (idempotente); disparo de E2 (`es_reenvio=false`) vía motor US-045.

**Flujo de edición en UC-15 (US-015):**
1. El Gestor solicita preview sin persistir (`POST /reservas/{id}/presupuesto/edicion/preview`): motor de tarifa UC-16 si cambian invitados/duración; desglose fiscal por las funciones puras del régimen del presupuesto vigente; sin efectos en BD.
2. Al confirmar la edición (`POST /reservas/{id}/presupuesto/edicion`), en **una única transacción**: INSERT de `Presupuesto` con `version = MAX(version)+1`, `tarifa_congelada = true`, `estado = 'enviado'` o `'borrador'` según `enviar`; si `enviado`: `numero_presupuesto = AAAANNN` (secuencia del régimen, reintento `P2002`); si `borrador`: `numero_presupuesto = null`; INSERT/UPDATE de `ReservaExtra` (precio congelado en líneas nuevas, existentes inalteradas); INSERT `AUDIT_LOG accion='actualizar'`.
3. Post-commit (solo si `enviar=true`): regeneración del PDF + UPDATE `pdf_url`; disparo de E2 con `es_reenvio=true` vía motor US-045.
4. Reenvío sin cambios (`POST /reservas/{id}/presupuesto/reenvio`): NO crea versión nueva; INSERT `COMUNICACION E2 es_reenvio=true` + `AUDIT_LOG`; responde `200`.

**Mapa de estados del PRESUPUESTO:**
- `borrador` — en UC-15 el Gestor puede guardar la edición sin enviar (`numero_presupuesto=null`, sin COMUNICACION); en UC-14 el preview no persiste (no se inserta fila)
- `enviado` — al confirmar en UC-14 o al confirmar la edición con `enviar=true` en UC-15; `numero_presupuesto` asignado; PDF adjuntado en E2
- `aceptado` — cuando el cliente acepta; guarda de UC-15: un presupuesto `aceptado` no puede editarse
- `rechazado` — cuando el cliente rechaza

### 3.12 Factura
Facturas de señal (40%), liquidación (60% + extras), fianza y complementarias.

| Campo | Tipo | Reglas / Notas |
|---|---|---|
| `id_factura` | `String @id @default(uuid())` | |
| `tenant_id` | `String` | FK → `Tenant` |
| `reserva_id` | `String` | FK → `Reserva` |
| `numero_factura` | `String?` | Secuencial `F-2026-0001`. **Nullable en borradores** (US-027): los borradores de liquidación y fianza se crean con `numero_factura = NULL`; la numeración se asigna al emitir (US-028). El constraint `UNIQUE(tenant_id, numero_factura)` solo aplica a valores no nulos. Migración: `20260704130000_us027_numero_factura_nullable` (DROP NOT NULL, aditiva). |
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

**Ciclo de vida de los borradores de liquidación y fianza (US-027 / UC-21 pasos 1-2 / UC-22 pasos 1-2):**

Al activarse los sub-procesos paralelos de una RESERVA que ha transitado a `reserva_confirmada` (efecto post-commit de US-021, espejo del disparo de la factura de señal de US-022), el use-case `GenerarBorradoresLiquidacionFianzaUseCase` crea **dos documentos en borrador** en una transacción propia de facturación (atómica entre ambos documentos y sus AUDIT_LOG); su fallo **no revierte** la confirmación ya realizada y la operación es reintentable por idempotencia.

- **Factura de liquidación**: `tipo = 'liquidacion'`, `estado = 'borrador'`, `numero_factura = NULL`, `total = RESERVA.importe_liquidacion + Σ(RESERVA_EXTRA.subtotal WHERE factura_id IS NULL)`. El `importe_liquidacion` viene **congelado** de US-021 (60 % MVP); este use-case no recalcula porcentaje ni tarifa. Los `subtotal` ya congelados por línea se suman sin recalcular. **No se marca** `factura_id` en `RESERVA_EXTRA` mientras el documento está en borrador: ese marcado ocurre al emitir (US-028). Desglose fiscal idéntico al de la señal: `base_imponible = round(total / 1,21, 2)`, `iva_importe = total − base_imponible`.
- **Recibo de fianza**: `tipo = 'fianza'`, `estado = 'borrador'`, `numero_factura = NULL`, `total = TENANT_SETTINGS.fianza_default_eur`. Si `fianza_default_eur = 0`, el recibo **no se genera**; `RESERVA.fianza_status` permanece `pendiente` y la alerta al Gestor menciona solo la liquidación.
- **Idempotencia**: guarda de existencia por `(reserva_id, tipo)` + constraint `UNIQUE(reserva_id, tipo)` (ya migrado en US-022) como red de seguridad. Una reinvocación del trigger no duplica los borradores.
- **Alerta al Gestor**: señal de UI "Documentos de liquidación y fianza pendientes de revisión" (o solo la liquidación si la fianza se omitió). No es un email (E4 se dispara en US-028 tras la aprobación del Gestor).
- **Auditoría**: `AUDIT_LOG` con `accion = 'crear'`, `entidad = 'FACTURA'` por cada documento creado.
- **Endpoint de consulta**: `GET /reservas/{id}/facturas` — devuelve la colección de facturas de la reserva (señal, liquidación, fianza) filtrable por tipo; implementado en US-027.

### 3.13 Pago
Cobro conciliado contra una factura. El justificante es un `Documento(tipo=justificante_pago)`. Materializado en US-029 mediante migración aditiva `20260704150000_us029_pago_tenant_id`. La entidad se reutiliza sin cambios de modelo para el cobro de la fianza (US-030).

| Campo | Tipo | Reglas / Notas |
|---|---|---|
| `id_pago` | `String @id @default(uuid())` | Identificador único |
| `tenant_id` | `String` | FK → `Tenant`. **US-029 D-1**: campo explícito en toda tabla de negocio (regla dura de multi-tenancy/RLS del proyecto). La policy RLS filtra por `PAGO.tenant_id` directo (sin join a FACTURA). Índice `@@index([tenantId])`. |
| `factura_id` | `String` | FK → `Factura`. **Cardinalidad FACTURA 1-N PAGO**: prevé cobros parciales futuros. **Sin `@@unique([facturaId])`**: la unicidad de cobro en el MVP la garantiza la guarda de estado (`liquidacion_status` / `fianza_status` bajo `SELECT ... FOR UPDATE`), no un constraint de BD. Índice `@@index([facturaId])`. |
| `importe` | `Decimal @db.Decimal(10,2)` | Importe real cobrado por el Gestor. `> 0` (validación de dominio puro). Puede diferir de `Factura.total`; la discrepancia alerta pero no bloquea el cobro. El PAGO no recalcula el desglose fiscal de la factura (inmutable desde la emisión). |
| `fecha_cobro` | `DateTime @db.Date` | Fecha del cobro. La regla de validación depende del tipo de cobro: para la **liquidación** (US-029), `fecha_cobro ≤ hoy`; para la **fianza** (US-030), `fecha_cobro ≤ RESERVA.fecha_evento` (relativo al evento, no a hoy; el cobro en T-0 es válido). Ambas validaciones son lógica de dominio puro. |
| `justificante_doc_id` | `String?` | FK nullable → `Documento(tipo=justificante_pago)`. El justificante es **opcional**; si no se adjunta, `NULL`; el cobro avanza igualmente a `cobrada`. |
| `fecha_creacion` | `DateTime @default(now())` | |

**Guarda de doble cobro — liquidación (US-029 / UC-21):** el use-case `RegistrarCobroLiquidacionUseCase` abre una `$transaction`, relee `Reserva.liquidacion_status` con `SELECT ... FOR UPDATE` sobre la fila de RESERVA y aplica la guarda: `'facturada'` procede; `'cobrada'` aborta con 409 "La liquidación ya está marcada como cobrada"; `'pendiente'` aborta con 409 "La factura de liquidación debe estar enviada antes de registrar su cobro". El lock de fila PostgreSQL serializa concurrencia sin locks distribuidos (regla dura del proyecto).

**Guarda de doble cobro — fianza (US-030 / UC-22 pasos 5-9):** el use-case `RegistrarCobroFianzaUseCase` abre una `$transaction`, relee `Reserva.fianza_status` con `SELECT ... FOR UPDATE` sobre la fila de RESERVA y aplica la guarda:
- `'recibo_enviado'` → procede (happy path): crea el `DOCUMENTO` (si aplica) + el `PAGO`, transiciona `FACTURA(fianza).estado = 'cobrada'` + `RESERVA.fianza_status = 'cobrada'`, actualiza `RESERVA.fianza_eur = importe` y `RESERVA.fianza_cobrada_fecha = fecha_cobro` + `AUDIT_LOG`, todo en el mismo commit.
- `'cobrada'` → aborta con 409 `FIANZA_YA_COBRADA` ("La fianza ya está marcada como cobrada"). Dos peticiones concurrentes se serializan: la segunda ve `cobrada` bajo lock y aborta. Sin locks distribuidos (regla dura del proyecto).
- `'pendiente'` → **política "Negociable"** (diverge del bloqueo duro de la liquidación): el sistema **no bloquea de forma dura**. Sin el flag `confirmarSinRecibo = true` en el body → respuesta 200 `confirmacion_requerida` ("El recibo de fianza no ha sido enviado al cliente. ¿Desea registrar el cobro igualmente?"), sin crear PAGO ni cambiar estados; con `confirmarSinRecibo = true` → el cobro se registra igualmente y el flujo excepcional queda trazado en `AUDIT_LOG`. Tratamiento de la `FACTURA(fianza)` en la política "Negociable" confirmada (D-2b, gate SDD aprobado): si la FACTURA(fianza) existe en `'borrador'` → salta directamente `borrador → cobrada` (sin pasar por `enviada`), documentando el salto en `AUDIT_LOG`; si no existe FACTURA(fianza) (fianza omitida por `fianza_default_eur = 0`) → se crea al vuelo y se marca `cobrada`, con traza de `'crear'` en `AUDIT_LOG`.

**Discrepancia de importe (US-029 / D-3):** aplica únicamente al cobro de la liquidación. Para la fianza (US-030), `RESERVA.fianza_eur` se registra como el importe real cobrado; no se emite alerta de discrepancia.

**`liquidacion_status = cobrada` como precondición de `evento_en_curso` (US-031):** al completar el cobro, `RESERVA.liquidacion_status = 'cobrada'` habilita una de las tres precondiciones de la transición `reserva_confirmada → evento_en_curso`. Las otras dos son `pre_evento_status = cerrado` y `fianza_status = cobrada`. `RESERVA.estado` permanece `reserva_confirmada` tras el cobro; la transición a `evento_en_curso` es responsabilidad de US-031.

**`fianza_status = cobrada` como tercera precondición de `evento_en_curso` (US-030 / US-031):** al registrar el cobro de la fianza, `RESERVA.fianza_status = 'cobrada'` habilita la **tercera** de las tres precondiciones de la transición `reserva_confirmada → evento_en_curso` (junto con `pre_evento_status = cerrado` y `liquidacion_status = cobrada`). `RESERVA.estado` permanece `reserva_confirmada` tras el cobro; la transición a `evento_en_curso` no se evalúa en US-030 y es responsabilidad de US-031. Alerta FA-01 (no bloqueante): si en el día del evento `fianza_status ≠ 'cobrada'`, la política hardcoded "Negociable" genera una alerta crítica no bloqueante ("⚠️ Fianza pendiente de cobro. Puede registrarla ahora o proceder sin ella (política Negociable)"); el inicio del evento no se bloquea por fianza impagada. La integración de FA-01 en el flujo de transición es responsabilidad de US-031.

### 3.14 FichaOperativa
Datos operativos del evento, cumplimentados progresivamente. Relación 1:1 con la reserva. La entidad se crea vacía al confirmar la señal (US-021); los campos de contenido se rellenan con el guardado parcial progresivo de US-025. Ver comportamiento completo en `er-diagram.md §3.14`.

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
| `ficha_cerrada` | `Boolean @default(false)` | `true` al cerrar (US-025); no revierte a `false` |
| `fecha_cierre` | `DateTime?` | `now()` al cerrar; se actualiza en cada guardado post-cierre (D-4) |
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

**Persistencia de `tipo=condiciones_particulares` en E3 (US-023, change `condiciones-particulares-e3-us023`):** al ejecutar `POST /reservas/{id}/facturas/senal/enviar`, el use-case `EnviarFacturaSenalUseCase` crea o reutiliza **un único** `DOCUMENTO` con `tipo='condiciones_particulares'` dentro de la misma transacción atómica (`reservaId`, `tenantId`, `url` = clave `condiciones/{tenantId}.pdf`, `mimeType='application/pdf'`). Idempotencia: si ya existe un `DOCUMENTO` de ese tipo para la reserva (reenvíos futuros vía `POST .../reenviar`), se reutiliza sin crear una segunda fila ni registrar un segundo AUDIT_LOG `crear`. Sin migración: el enum `TipoDocumento` ya incluía `condiciones_particulares`.

### 3.16 Comunicacion
Log de emails enviados (E1–E8 + manuales). El motor hexagonal `DespacharEmailService` (US-045) es el único responsable de registrar y actualizar las entradas de esta entidad para los emails del ciclo de vida. La primera superficie HTTP del módulo (US-046) expone las acciones manuales del Gestor (listar, enviar borrador, descartar, email manual) como sub-recurso de la RESERVA.

| Campo | Tipo | Reglas / Notas |
|---|---|---|
| `id_comunicacion` | `String @id @default(uuid())` | |
| `tenant_id` | `String` | FK → `Tenant` |
| `reserva_id` | `String?` | FK → `Reserva` (nullable — solo NULL cuando el email `manual` se crea fuera del contexto de una RESERVA; los emails `manual` creados desde la ficha de la reserva en US-046 llevan `reserva_id` NOT NULL) |
| `cliente_id` | `String` | FK → `Cliente` (destinatario) |
| `codigo_email` | `CodigoEmail` | `E1 … E8 \| manual` |
| `asunto` | `String` | Máx. 255 |
| `cuerpo` | `String? @db.Text` | |
| `destinatario_email` | `String` | |
| `estado` | `EstadoComunicacion` | `borrador \| enviado \| fallido` |
| `fecha_envio` | `DateTime?` | No nulo **solo** si `estado = 'enviado'`; nulo en `borrador` y `fallido` |
| `fecha_creacion` | `DateTime @default(now())` | |

**Idempotencia (US-045 / US-028 / US-046 — migración `20260628120000_us045_comunicacion_idempotencia_indice`):** índice UNIQUE parcial `uq_comunicacion_reserva_codigo` sobre `(reserva_id, codigo_email) WHERE reserva_id IS NOT NULL AND es_reenvio = false AND codigo_email <> 'manual'`. Garantiza una sola entrada por `(reserva, codigo_email)` para envíos originales E1–E8. Es parcial para que los reenvíos explícitos (`es_reenvio = true`) y los emails `manual` queden fuera del constraint:
- `es_reenvio = true` → fuera del predicado (permite múltiples `COMUNICACION E4` para la misma reserva cuando el Gestor reenvía la factura, US-028 D-4).
- `codigo_email = 'manual'` → excluidos por el predicado `AND codigo_email <> 'manual'` (permite varios emails manuales por reserva, US-046 D-5 Opción C). Los emails `manual` llevan `reserva_id` NOT NULL y `es_reenvio = false` (semántica honesta: no son reenvíos).
El motor consulta la existencia antes de insertar; el índice actúa como red de seguridad ante carreras concurrentes (violación → `ComunicacionDuplicadaError`, no 500). La migración D-5 de US-046 recreó el índice añadiendo `AND codigo_email <> 'manual'`; la D-4 de US-028 había añadido `AND es_reenvio = false`. Ambas son aditivas; E1–E8 conservan su idempotencia. Ver también §5.

**Email E1 en el alta de consulta (UC-03 / US-003/004 + US-045 motor real):** el alta crea siempre la `COMUNICACION` E1 dentro de la `$transaction` con `estado = 'borrador'` (estado no final, sin `fecha_envio`). Post-commit, el motor `DespacharEmailService.finalizarEnvio` la promueve:
- Sin comentarios → `estado = 'enviado'` + `fecha_envio = now()` (envío real vía `ResendEmailAdapter` en producción; `FakeEmailAdapter` en test/CI/dev).
- Con comentarios → permanece en `borrador` sin `fecha_envio` (pendiente de revisión manual, UC-36 / US-046).
- Fallo del proveedor → `estado = 'fallido'` sin `fecha_envio` + registro en `AUDIT_LOG`. Sin reintento. La respuesta HTTP es 201 igualmente (fallo de email no revierte la reserva).

**Email E6 en la transición a 2.v (UC-07 / US-008 / D-6):** tras el COMMIT de la transición `{2a|2b|2c} → 2v` (RESERVA + FECHA_BLOQUEADA + AUDIT_LOG all-or-nothing), el motor `DespacharEmailService` (US-045) dispara el envío del email **E6** (confirmación de visita programada con fecha y hora) al cliente y registra en `COMUNICACION` con `codigo_email = 'E6'`, `estado = 'enviado'`, `reserva_id`, `cliente_id` y `tenant_id`. El disparo es **posterior al commit** y no bloqueante: un fallo del proveedor no revierte el `sub_estado = '2v'` ni el bloqueo ya comprometido; el fallo queda trazado en `COMUNICACION` (estado distinto de `'enviado'`) para seguimiento/reintento, coherente con el patrón de US-045. E6 se registra en todos los casos de transición exitosa, independientemente de si el bloqueo fue INSERTado (origen `2a`) o UPDATEado (origen `2b`/`2c`). En test/CI el transporte opera en **modo fake** (sin envíos reales). La idempotencia del índice UNIQUE parcial `(reserva_id, codigo_email) WHERE reserva_id IS NOT NULL` impide duplicar la fila E6 ante retries. Fuente: `design.md §D-6`; `specs/comunicaciones/spec.md`.

**Email E2 en la confirmación de presupuesto / activación de pre-reserva (UC-14 / US-014):** tras el COMMIT de la transacción `{2a|2b|2c|2v} → pre_reserva` (PRESUPUESTO + RESERVA + FECHA_BLOQUEADA + cola A16 + AUDIT_LOG all-or-nothing), el motor `DespacharEmailService` (US-045) dispara el envío del email **E2** (presupuesto formal con PDF adjunto) al cliente y registra en `COMUNICACION` con `codigo_email = 'E2'`, `estado = 'enviado'`, `reserva_id`, `cliente_id`. El PDF se genera post-commit mediante el puerto de PDF (Puppeteer / react-pdf; modo fake en dev/CI, `pdf_url = null`); una vez generado, se actualiza `PRESUPUESTO.pdf_url` y se referencia en E2. El disparo es **posterior al commit** y no bloqueante: un fallo del proveedor de email o de generación del PDF no revierte la `pre_reserva` ya comprometida; el fallo queda trazado en `COMUNICACION` para seguimiento. La idempotencia del índice UNIQUE parcial `(reserva_id, codigo_email) WHERE reserva_id IS NOT NULL` impide duplicar la fila E2 ante retries. Fuente: `design.md §D-6`; UC-14.

**Extensión de E1 en la transición 2.a → 2.b (UC-04 / US-005 / D-6):** tras el COMMIT de la transición `2a → 2b`, el sistema registra/actualiza la `COMUNICACION` E1 de confirmación de bloqueo provisional y la envía con el motor de US-045. Este email **no tiene código `E` propio** en el catálogo (§9.3 E1–E8): es una extensión de E1 adaptando el copy a "bloqueo provisional confirmado". Dado que el índice UNIQUE parcial `(reserva_id, codigo_email) WHERE reserva_id IS NOT NULL` impide una segunda fila `(reserva, E1)`, el adaptador `ConfirmacionBloqueoEmailAdapter` hace un **UPSERT** de la fila existente (`findFirst + update/create`): si ya existe una E1 previa (creada en el alta), actualiza el asunto y cuerpo al contenido de confirmación; si no existe, la crea. El envío es **post-commit y no bloqueante**: un fallo de envío no revierte la RESERVA `2b` ni la `FECHA_BLOQUEADA` ya comprometidos. Fuente: `design.md §D-6`.


**Email E8 en el registro del IBAN de devolución (UC-26 FA-01 / UC-27 pasos 1–3 / US-035):** tras el COMMIT de la transacción de escritura del IBAN (`UPDATE CLIENTE.iban_devolucion` + `INSERT AUDIT_LOG`), el motor `DespacharEmailService` (US-045) despacha el email **E8** (confirmación de recepción del IBAN + próximos pasos para la devolución de la fianza) al `CLIENTE.email` — nunca al gestor — y registra en `COMUNICACION` con `codigo_email = 'E8'`, `estado = 'enviado'`, `fecha_envio`, `reserva_id`, `cliente_id` y `tenant_id`. El disparo es **posterior al commit y no bloqueante** (patrón guardar-luego-enviar, `design.md §D-2`): un fallo del proveedor no revierte el IBAN ya persistido; `COMUNICACION.estado = 'fallido'` sin `fecha_envio`, y el gestor recibe alerta para reintentar desde la ficha. **Excepción auditada a la idempotencia (D-3A):** el índice UNIQUE parcial `(reserva_id, codigo_email) WHERE reserva_id IS NOT NULL AND es_reenvio = false` protege contra duplicados por disparos automáticos, pero cada registro/corrección intencional del IBAN por el gestor inserta una **nueva** `COMUNICACION` E8 con `es_reenvio = true` (igual que el reenvío de E4 en US-028, `design.md §D-3`): al marcarse `es_reenvio = true` la fila queda fuera del predicado del índice y el constraint no aplica. Esto garantiza trazabilidad completa de cada confirmación enviada con cada versión del IBAN. En test/CI el transporte opera en **modo fake** (sin envíos reales). Fuente: `design.md §D-2..D-3`; `specs/comunicaciones/spec.md`; UC-26/UC-27.

**Tarifa estimada en E1 (US-004 / D-4):** si el alta incluye `fecha_evento` + `num_adultos_ninos_mayores4` + `duracion_horas`, E1 incorpora la tarifa calculada vía `TarifaEstimadaPort` (motor UC-16); si falta algún dato o el cálculo no es posible (`TEMPORADA_NO_CONFIGURADA`, `TARIFA_NO_CONFIGURADA`, `tarifa_a_consultar = true`), E1 se envía con el **dossier general sin precio exacto**. La imposibilidad de calcular la tarifa **no bloquea el alta ni el bloqueo de fecha**. La tarifa estimada no se persiste en `RESERVA` (decorativa de E1). Fuente: `design.md §D-4`.

**Reglas de validación del estado:**
- `tenant_id` y `cliente_id` siempre no nulos.
- `reserva_id` no nulo para E1–E8 y para emails `manual` creados desde la ficha de una RESERVA (US-046); solo nullable para emails `manual` creados fuera del contexto de una reserva.
- `es_reenvio = false` para todos los emails originales, incluidos los `manual` de US-046 (no son reenvíos); `es_reenvio = true` para reenvíos explícitos del Gestor (US-028, US-035 D-3).
- `fecha_envio` no nulo si y solo si `estado = 'enviado'`.
- **Convención de descarte (US-046):** el descarte de un borrador por el Gestor se modela como `estado = 'fallido'` (no existe un estado "descartado" en `EstadoComunicacion`) + `AUDIT_LOG` con causa "descartado por gestor". Esta causa distingue el descarte del fallo real del proveedor.

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

**Convención de auditoría de Sistema — barrido de archivado (US-037 / UC-28):** el barrido `POST /cron/barrido-completadas` genera dos tipos de entrada, ambas con `usuario_id = NULL` (origen Sistema):
- **Transición exitosa:** `accion = 'transicion'`, `entidad = 'RESERVA'`, `datos_anteriores = {estado: post_evento}`, `datos_nuevos = {estado: reserva_completada, causa: 'T+7d'}`. Nunca se duplica (idempotencia por filtro `estado = 'post_evento'`).
- **Alerta FA-01 — fianza pendiente en T+7d:** `accion = 'actualizar'`, `entidad = 'RESERVA'`, `datos_nuevos = {tipo: 'fianza_pendiente_t7d', reserva_id, codigo}`. Emitida solo si no existe ya una entrada `fianza_pendiente_t7d` para la misma RESERVA posterior al último cambio de `fianza_status` (anti-duplicación por Opción 4.2 del gate). La RESERVA permanece en `post_evento`; no se genera entrada de transición. El canal de entrega de la alerta al gestor (in-app, dashboard) corresponde a US-044. Esta convención es consistente con la usada por US-012 (expiración), US-026 (cierre de fichas) y US-031 (inicio de evento).

**Convención de auditoría de Gestor — archivado manual (US-038 / UC-28 flujo alternativo B):** el endpoint `POST /reservas/{id}/archivar` genera exactamente una entrada cuando la transición tiene éxito, con `usuario_id = <id del gestor del JWT>` (origen Gestor, no nulo — diferencia clave con US-037):
- **Transición exitosa:** `accion = 'transicion'`, `entidad = 'RESERVA'`, `entidad_id = <reservaId>`, `datos_anteriores = {estado: post_evento}`, `datos_nuevos = {estado: reserva_completada}` (sin `causa: 'T+7d'`; opcionalmente `causa: 'manual'`). La entrada no se escribe si la guarda de origen falla (409 `transicion_no_permitida`) ni si la guarda de fianza falla (422 `fianza_no_resuelta`). La serialización por `SELECT … FOR UPDATE` garantiza que, en la race condition entre el cron de US-037 y el gestor de US-038, exactamente una entrada de `AUDIT_LOG` se genera para la RESERVA.

---

## 4. Relaciones (resumen)

```
Tenant 1──1 TenantSettings
Tenant 1──N Usuario, Cliente, Reserva, FechaBloqueada, Tarifa,
            TemporadaCalendario, Extra, Factura, Pago, Documento, Comunicacion, AuditLog
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
| `@@index([estado, fechaPostEvento])` | `Reserva` | Selección eficiente de candidatas al barrido de archivado automático (US-037): filtra por `estado = 'post_evento'` y compara `fechaPostEvento` con el umbral T+7d. Migración aditiva `20260710130000_us037_reserva_fecha_post_evento`. |
| `@@index([tenant_id, consulta_bloqueante_id, posicion_cola])` | `Reserva` | Promoción y reordenación de cola |
| `@@index([tenant_id, email])` | `Cliente` | Búsqueda de cliente y recurrencia |
| Full-text (`nombre`, `codigo`, `notas`) | `Reserva` | Histórico consultable (`UC-32`) |
| UNIQUE parcial `(tenant_id, consulta_bloqueante_id, posicion_cola) WHERE posicion_cola IS NOT NULL` | `Reserva` | Unicidad de posición en cola; defensa en profundidad D-5 / D-8 (US-004). Migración aditiva `20260628120000_us004_cola_posicion_unique`; índice activo en BD: `reserva_cola_posicion_key` |
| `UNIQUE PARTIAL (reserva_id, codigo_email) WHERE reserva_id IS NOT NULL AND es_reenvio = false AND codigo_email <> 'manual'` | `Comunicacion` | Idempotencia del motor de email (US-045, D-4 US-028, D-5 US-046): una `COMUNICACION` de envío original por `(reserva, codigo_email)` para E1–E8; reenvíos explícitos (`es_reenvio = true`) quedan fuera del predicado; emails `manual` quedan excluidos por `AND codigo_email <> 'manual'`, permitiendo varios manuales por reserva. Los `manual` llevan `reserva_id` NOT NULL y `es_reenvio = false`. Migración `20260628120000_us045_comunicacion_idempotencia_indice`; predicado ampliado por D-4 US-028 y D-5 US-046. |
| `@@index([tenantId])` | `Pago` | Filtrado RLS directo por `tenant_id` (US-029 D-1). La policy RLS de PAGO usa `PAGO.tenant_id` directamente, sin join a FACTURA. Migración `20260704150000_us029_pago_tenant_id`. |
| `@@index([facturaId])` | `Pago` | Búsqueda de pagos por factura (US-029). Soporta la cardinalidad FACTURA 1-N PAGO sin `UNIQUE`. Migración `20260704150000_us029_pago_tenant_id`. |

---

## 6. Reglas de validación transversales

- **Multi-tenant:** toda consulta debe filtrar por `tenant_id` (reforzado por RLS). Una entidad nunca puede referenciar otra de un tenant distinto.
- **Importes:** `Decimal(10,2)`, nunca `Float` (evita errores de redondeo en facturación). Porcentajes en `Decimal(4,2)`.
- **Fechas de evento:** `fecha_evento > hoy` (estrictamente futura, día natural) es la **regla de fecha unificada del proyecto** (`esFechaEstrictamenteFutura` / `validarFechaFutura`). Se aplica en: alta de consulta con fecha (US-004, `POST /reservas`), transición `2a → 2b/2d` (US-005, `POST /reservas/{id}/fecha`), toda operación de bloqueo atómico (US-040, `bloquearFecha()`) y el motor de tarifa (UC-16 / US-016). El servidor rechaza `fecha_evento = hoy` y fechas pasadas con **400** sin crear registros ni mutar la RESERVA. La ficha US-004 admitía `≥ hoy` y la ficha US-005 también; en ambos casos la resolución del Gate SDD adoptó `> hoy` para mantener **una única regla de "fecha válida"** en todo el sistema. Para consultas históricas, `fecha_evento` puede ser cualquier valor (ya ocurridas). La UI impide seleccionar hoy y fechas pasadas (`min = mañana`).
- **IVA:** 21% por defecto; `iva_importe = round(base_imponible × iva_porcentaje / 100, 2)`; `total = base_imponible + iva_importe`.
- **Señal/Liquidación:** `importe_senal = round(importe_total × pct_senal / 100, 2)`; `importe_liquidacion = importe_total − importe_senal`.
- **Soft-delete:** las entidades con `activo` no se borran físicamente; se marcan `activo = false`.
- **Auditoría:** toda transición de estado de `Reserva` y toda emisión de `Factura` genera un `AuditLog`.

---

*Documento de modelo de datos v2.6 (10/07/2026). Derivado y consistente con [er-diagram.md](./er-diagram.md) v4.4. v2.6: refleja US-037 — Archivado Automático a `reserva_completada` en T+7d (UC-28): añade campo `fecha_post_evento DateTime? @map("fecha_post_evento")` en la tabla de campos de §3.5 Reserva (migración aditiva `20260710130000_us037_reserva_fecha_post_evento`); añade nota de flujo completo de US-037 en §3.5 (transición terminal `post_evento → reserva_completada`, guarda de fianza resuelta, barrido `POST /cron/barrido-completadas`, idempotencia, concurrencia con US-038, alerta FA-01 anti-duplicada en AUDIT_LOG); añade índice `@@index([estado, fechaPostEvento])` en §5; amplía §3.17 AuditLog con la convención de Sistema para archivado (transición T+7d y alerta FA-01 `fianza_pendiente_t7d`).*

*Documento de modelo de datos v2.5 (10/07/2026). Derivado y consistente con [er-diagram.md](./er-diagram.md) v4.2. v2.5: refleja US-036 — Registrar Devolución de Fianza (UC-27 pasos 4–8): añade campo `motivo_retencion String? @db.Text` en la tabla de campos de §3.5 Reserva (migración aditiva `20260710120000_us036_reserva_motivo_retencion`); añade nota de flujo completo de US-036 en §3.5 (precondición `post_evento AND fianza_status=cobrada`, tres modalidades devolución/parcial/retención, guarda `SELECT … FOR UPDATE`, irreversibilidad, 409 `PRECONDICION_NO_CUMPLIDA`/`DEVOLUCION_YA_REGISTRADA`, 400 `IMPORTE_SUPERA_FIANZA`/`FECHA_DEVOLUCION_INVALIDA`/`MOTIVO_RETENCION_REQUERIDO`, 404 `JUSTIFICANTE_NO_ENCONTRADO`, DOCUMENTO opcional, AUDIT_LOG). Sin entidades ni índices nuevos.*

*Documento de modelo de datos v2.4 (09/07/2026). Derivado y consistente con [er-diagram.md](./er-diagram.md) v4.1. v2.4: refleja US-035 — Registrar IBAN de Devolución (UC-26 FA-01, UC-27 pasos 1–3): amplía §3.4 Cliente — enriquece la descripción de `iban_devolucion` con el flujo completo de US-035 (endpoint `PATCH /reservas/{id}/iban-devolucion`, validación mod-97 en dominio, transacción UPDATE CLIENTE + AUDIT_LOG, disparo post-commit de E8 guardar-luego-enviar, excepción auditada D-3A al idice UNIQUE parcial de idempotencia creando nueva COMUNICACION por cada reenvío intencional, precondición dual `estado=post_evento AND fianza_eur>0` con rechazo 409, fallo de E8 sin revertir IBAN); añade en §3.16 Comunicacion la nota de E8 (patrón post-commit no bloqueante, D-3A reenvío como nueva fila, modo fake en test/CI). Sin entidades, columnas ni índices nuevos.*

*Documento de modelo de datos v2.3 (05/07/2026). Derivado y consistente con [er-diagram.md](./er-diagram.md) v4.1. v2.3: refleja US-029 — Gestor Registra el Cobro de la Liquidación (UC-21 pasos 7-10): amplía §3.13 Pago — añade `tenant_id` explícito (D-1, FK → Tenant, policy RLS directa por `PAGO.tenant_id` sin join a FACTURA, migración `20260704150000_us029_pago_tenant_id`); documenta cardinalidad FACTURA 1-N PAGO sin `@@unique([facturaId])` (la unicidad la garantiza la guarda de estado bajo `SELECT ... FOR UPDATE`); documenta validaciones de dominio (`importe > 0`, `fecha_cobro ≤ hoy`); `justificante_doc_id` nullable con tipo `justificante_pago`; guarda de doble cobro (atómica, lock de fila, sin locks distribuidos); discrepancia informativa; `liquidacion_status = cobrada` como precondición de US-031 con `RESERVA.estado` permaneciendo `reserva_confirmada`; añade dos índices de PAGO en §5; añade `Pago` en el resumen de relaciones §4. Sin entidades ni enums nuevos.*

*Documento de modelo de datos v2.2 (04/07/2026). Derivado y consistente con [er-diagram.md](./er-diagram.md) v3.7. v2.2: refleja US-027 — Generar Borradores de Liquidación y Fianza (UC-21 pasos 1-2 / UC-22 pasos 1-2): actualiza §3.12 FACTURA — `numero_factura` pasa a nullable (migración `20260704130000_us027_numero_factura_nullable`, DROP NOT NULL aditiva; los NULL no colisionan en el UNIQUE por tenant); añade nota del ciclo de vida de los borradores de liquidación y fianza post-commit (disparo desde activación de sub-procesos de US-021, transacción propia de facturación, cálculo `importe_liquidacion + Σ extras IS NULL`, desglose fiscal reutilizado de US-022, edge case `fianza_default_eur = 0`, idempotencia `UNIQUE(reserva_id, tipo)`, alerta al Gestor, AUDIT_LOG, endpoint `GET /reservas/{id}/facturas`). Sin entidades ni índices nuevos.*
*Documento de modelo de datos v2.1 (03/07/2026). Derivado y consistente con [er-diagram.md](./er-diagram.md) v3.4. v2.1: refleja US-010 — Registrar resultado de visita: reserva inmediata (2.v → pre_reserva / UC-08 FA-08): añade en §3.5 RESERVA la nota de transición `2v → pre_reserva` (guarda mono-estado `esOrigenValidoParaResultadoVisitaReservaInmediata`, validación de datos obligatorios UC-14 con `camposFaltantes[]`, transacción única all-or-nothing RESERVA + FECHA_BLOQUEADA UPDATE puro + vaciado cola A16 + AUDIT_LOG, sin email propio, sin migración). Sin entidades, columnas ni índices nuevos.*
*Documento de modelo de datos v2.0 (03/07/2026). Derivado y consistente con [er-diagram.md](./er-diagram.md) v3.3. v2.0: refleja US-014 — Generar Presupuesto y Activar Pre-reserva (UC-14): corrige §3.6 mapa fase→TTL — modo `pre_reserva` pasa de `insert` a `insert-o-update` (la transición desde `2b`/`2c`/`2v` actualiza la fila existente; desde `2a` la inserta) y añade nota explicativa; amplía §3.5 RESERVA — añade nota de transición `{2a,2b,2c,2v} → pre_reserva` (guarda declarativa `ORIGENES_TRANSICION_ACTIVAR_PRERESERVA`, precondición datos fiscales CLIENTE con `camposFaltantes[]`, transacción única all-or-nothing INSERT PRESUPUESTO + UPDATE RESERVA + insert-o-update FECHA_BLOQUEADA + vaciado cola A16 + AUDIT_LOG, PDF y E2 post-commit, sin migración); amplía §3.11 Presupuesto — añade descripción del flujo de creación en UC-14, mapa de estados (`borrador`/`enviado`/`aceptado`/`rechazado`), nota de ausencia de `tenant_id`, nota de deuda de `tarifa_id` pendiente de UC-15, enriquece descripción de campos con notas de nullable/defaults/derivados; añade nota de E2 en §3.16 COMUNICACION (trigger post-commit de la confirmación `{2a|2b|2c|2v} → pre_reserva`, PDF adjunto por referencia a `PRESUPUESTO.pdf_url`, idempotencia, modo fake en dev/CI). Sin entidades ni columnas nuevas (PRESUPUESTO ya existía en el modelo desde US-000). v1.9 (01/07/2026). Derivado y consistente con [er-diagram.md](./er-diagram.md) v3.0. v1.9: refleja US-018 — promoción automática de cola (UC-12): sin columnas ni índices nuevos; el modelo ya tenía `posicion_cola`, `consulta_bloqueante_id` y `ttl_expiracion`; la nota de `liberarFecha()` en §3.6 (remite a er-diagram.md §3.6) y la nota de la cola en er-diagram.md §5.2 reflejan el adaptador real. Ver [er-diagram.md](./er-diagram.md) v3.0 para el detalle.*
*Documento de modelo de datos v1.8 (30/06/2026). Derivado y consistente con [er-diagram.md](./er-diagram.md) v2.9. Cualquier cambio en el modelo debe actualizarse en ambos documentos y en `schema.prisma`. v1.8: refleja US-008 — programar visita al espacio (UC-07): añade en §3.5 la nota de transición `{2a,2b,2c}→2v` (guarda de origen declarativa, precondición `fecha_evento` NOT NULL para `2a`, ventana `fecha_visita ∈ [hoy+1, hoy+max_dias_programar_visita]` desde setting, INSERT-o-UPDATE de `FECHA_BLOQUEADA` con `ttl=visita+1 día`, atomicidad all-or-nothing con `FOR UPDATE`, AUDIT_LOG `accion='transicion'`, sub-estados `2d`/terminales rechazados, sin migración); añade en §3.16 la nota de E6 post-commit (trigger `{2a|2b|2c}→2v`, reuso motor US-045, post-commit no bloqueante, modo fake en test, idempotencia del índice UNIQUE parcial). Sin columnas ni índices nuevos.*
*Documento de modelo de datos v1.7 (29/06/2026). Derivado y consistente con [er-diagram.md](./er-diagram.md) v2.8. Cualquier cambio en el modelo debe actualizarse en ambos documentos y en `schema.prisma`. v1.7: refleja US-005 — transición de consulta exploratoria a consulta con fecha (UC-04): añade en §3.5 la nota de transición `2a → 2b/2d` (UPDATE de RESERVA existente, reuso de `bloquearEnTx`/`determinarAltaConFecha`/`esOrigenValidoParaAnadirFecha`, `AUDIT_LOG accion='transicion'`, campos `posicion_cola`/`consulta_bloqueante_id`/`ttl_expiracion` ya existentes, detalle vía `GET /reservas/{id}` — FIX 3); extiende la nota de divergencia de fecha a US-005 (Gate SDD resuelve `> hoy`, unificado con US-040/US-004/US-016); amplía la nota de reutilización de `bloquearEnTx` a US-005 D-4; extiende §3.16 Comunicacion con el upsert de E1 en la transición `2a→2b` (US-005 D-6 — `findFirst+update/create`, post-commit no bloqueante, mismo código E1, sin migración); actualiza §6 con la regla de fecha unificada `esFechaEstrictamenteFutura`. Sin columnas ni índices nuevos (todo el modelo de cola/bloqueo ya existía desde US-004/US-040).*
*Documento de modelo de datos v1.6 (29/06/2026). Derivado y consistente con [er-diagram.md](./er-diagram.md) v2.6. Cualquier cambio en el modelo debe actualizarse en ambos documentos y en `schema.prisma`. v1.6: refleja US-045 — motor de email automático (UC-35): actualiza §3.16 Comunicacion (motor `DespacharEmailService`, flujo E1 real post-commit con estados `borrador`/`enviado`/`fallido`, `fecha_envio` solo si `enviado`, `reserva_id` no nulo para E1–E8, fallo sin reintento) preservando la nota de tarifa estimada de US-004; añade índice UNIQUE parcial de idempotencia `(reserva_id, codigo_email) WHERE reserva_id IS NOT NULL` en §5 (migración `20260628120000_us045_comunicacion_idempotencia_indice`). Sin columnas nuevas en `COMUNICACION`.*
*Documento de modelo de datos v1.5 (28/06/2026). Derivado y consistente con [er-diagram.md](./er-diagram.md) v2.6. Cualquier cambio en el modelo debe actualizarse en ambos documentos y en `schema.prisma`. v1.5: refleja US-004 — alta de consulta con fecha (UC-03): divergencia intencional `fecha_evento > hoy` (§3.5, §6; Gate 1 decisión A; trazabilidad a `design.md §D-1` y `specs/consultas/spec.md`); función declarativa `determinarAltaConFecha` + entradas iniciales `2b`/`2d` en máquina de estados (§3.5); método `bloquearEnTx` en `FechaBloqueadaPrismaAdapter` para atomicidad RESERVA+FECHA_BLOQUEADA (§3.5); puerto `TarifaEstimadaPort` decorativo tolerante a errores en E1 (§3.16); índice UNIQUE parcial de cola `reserva_cola_posicion_key` (§5 / migración D-8 `20260628120000_us004_cola_posicion_unique`).*
*Documento de modelo de datos v1.4 (28/06/2026). Derivado y consistente con [er-diagram.md](./er-diagram.md) v2.5. Cualquier cambio en el modelo debe actualizarse en ambos documentos y en `schema.prisma`. v1.4: refleja los fixes finales de US-003: añade nota sobre generación del `codigo` correlativo con retry-on-conflict (`UnidadDeTrabajoPrismaAdapter`, hasta 3 reintentos) y red de seguridad `reserva_codigo_key` UNIQUE → 409 vía filtro global (§3.5); consistente con DT-CODIGO-01 RESUELTA en `architecture.md` §2.9. v1.3: refleja US-003 — alta de consulta exploratoria (UC-03): mapeo `SubEstadoConsulta` dominio `'2a'` ↔ Prisma `s2a` (prefijo `s`; helper `sub-estado-consulta.mapper.ts` en infrastructure, sin migración); nota sobre `apellidos`/`email`/`telefono` requeridos a nivel de contrato en el alta; regla `COMUNICACION` E1 auto-envío (`estado='enviado'`) vs borrador (`estado='borrador'`) según presencia de `comentarios`; puerto `EnviarEmailPort` con stub no-op hasta US-045. v1.2: refleja US-041 — `liberarFecha()` (UC-31): error `LIBERACION_FIRME_SIN_CANCELACION`, semántica rows-affected, seam `PromocionColaPort` (diferido a US-018), sin endpoint HTTP (D-7), y registros de auditoría con causa en `AuditLog`. v1.1: refleja US-040 — `reserva_id @unique` en `FechaBloqueada`, check constraints `chk_firme_sin_ttl`/`chk_blando_con_ttl`, mapa canónico fase→(tipo,TTL,modo) y errores de dominio de `bloquearFecha()`.*
*Documento de modelo de datos v1.3 (28/06/2026). Derivado y consistente con [er-diagram.md](./er-diagram.md) v2.4. Cualquier cambio en el modelo debe actualizarse en ambos documentos y en `schema.prisma`. v1.3: refleja US-002 — actualiza §3.17 AuditLog: descripción ampliada a "autenticación"; documenta convención `login`/`logout` (`entidad = 'Usuario'`, `entidad_id = usuario_id`) y la condicionalidad del registro de `logout` (solo cuando el token identifica usuario). v1.2: refleja US-041 — `liberarFecha()` (UC-31): error `LIBERACION_FIRME_SIN_CANCELACION`, semántica rows-affected, seam `PromocionColaPort` (diferido a US-018), sin endpoint HTTP (D-7), y registros de auditoría con causa en `AuditLog`. v1.1: refleja US-040 — `reserva_id @unique` en `FechaBloqueada`, check constraints `chk_firme_sin_ttl`/`chk_blando_con_ttl`, mapa canónico fase→(tipo,TTL,modo) y errores de dominio de `bloquearFecha()`.*
