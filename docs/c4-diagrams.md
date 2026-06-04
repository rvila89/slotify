# Diagramas C4 — Slotify

> **Documento**: Diagramas de Arquitectura C4 (PlantUML)
> **Proyecto**: Slotify — Plataforma SaaS de Gestión Integral para Espacios Boutique de Eventos Privados
> **Versión**: 1.0
> **Fecha**: 29/05/2026
> **Fuente**: architecture.md · SlotifyGeneralSpecs.md

---

## Resumen

Los diagramas C4 de Slotify se organizan en cuatro niveles que describen la arquitectura desde la perspectiva más amplia (actores y sistemas) hasta el detalle interno de los componentes. Se han modelado dos variantes del nivel Container: la **arquitectura de implementación del MVP** (monolito modular sobre Railway/Render + PostgreSQL gestionada, que es la que se construye realmente para el TFM) y la **arquitectura objetivo de producción** (microservicios sobre AWS, destino de evolución del producto a escala multi-tenant).

La decisión de diseño más relevante reflejada en todos los niveles es que **la reserva es el agregado raíz del sistema**: toda la lógica de estado, bloqueo de fecha y cola de espera orbita alrededor de ella. El bloqueo atómico de fecha —la protección contra la doble reserva, riesgo crítico #1— se resuelve mediante una restricción `UNIQUE(tenant_id, fecha)` en PostgreSQL y transacciones con `SELECT FOR UPDATE`, sin necesidad de locks distribuidos (Redis/Redlock) en ninguno de los dos niveles arquitectónicos.

La arquitectura hexagonal (puertos y adaptadores) aplicada en el backend NestJS garantiza que el dominio no dependa de la infraestructura, permitiendo testear la máquina de estados y el núcleo de reservas de forma aislada. Las automatizaciones (TTLs, cola de espera, recordatorios) se implementan en el MVP como un cron simple que invoca un endpoint protegido de barrido, evitando la complejidad de Lambda + EventBridge sin sacrificar corrección ni idempotencia.

---

## Nivel 1 — Context

> Muestra Slotify como caja negra e identifica sus actores (personas) y los sistemas externos con los que interactúa.

```plantuml
@startuml "slotify-c4-context"

!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Context.puml

LAYOUT_TOP_DOWN()
LAYOUT_WITH_LEGEND()

title System Context — Slotify

Person(gestor, "Gestor", "Propietario o gestor del espacio boutique de eventos. Único usuario interno del sistema en el MVP. Gestiona el ciclo completo de cada reserva.")

Person_Ext(cliente, "Cliente / Lead", "Contacta para consultar disponibilidad. Recibe comunicaciones por email: presupuestos, confirmaciones, recordatorios de pago y facturas.")

System(slotify, "Slotify", "Plataforma SaaS de gestión integral para espacios boutique de eventos privados. Unifica el ciclo completo: lead → consulta → presupuesto → reserva → ejecución → archivo. Proporciona visibilidad operativa, financiera e histórica en tiempo real.")

System_Ext(email_provider, "Proveedor de Email Transaccional", "Resend / Postmark / Amazon SES. Entrega los emails automáticos del flujo de reserva (plantillas E1–E8) y los emails manuales enviados por el gestor.")

System_Ext(storage, "Almacenamiento de Ficheros", "Servicio de almacenamiento de objetos (Supabase Storage en MVP / Amazon S3 en producción). Aloja PDFs generados (presupuestos, facturas) y justificantes de pago subidos por el gestor.")

Rel(gestor, slotify, "Gestiona reservas, presupuestos, facturación, calendario y configuración", "HTTPS")
Rel(slotify, cliente, "Envía presupuestos, confirmaciones, recordatorios y facturas", "Email (vía proveedor)")
Rel(slotify, email_provider, "Delega el envío de emails transaccionales", "HTTPS / API")
Rel(slotify, storage, "Almacena y recupera PDFs y documentos del evento", "HTTPS / API")

@enduml
```

---

## Nivel 2 — Container (MVP)

> Descompone el sistema Slotify en sus contenedores de la arquitectura de implementación del MVP: una SPA React servida desde un CDN, un backend NestJS con lógica de dominio, y una base de datos PostgreSQL. Es la arquitectura que se construye para el TFM.

```plantuml
@startuml "slotify-c4-container-mvp"

!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml

LAYOUT_TOP_DOWN()
LAYOUT_WITH_LEGEND()

title Container Diagram — Slotify MVP (Monolito Modular)

Person(gestor, "Gestor", "Propietario o gestor del espacio boutique de eventos.")
Person_Ext(cliente, "Cliente / Lead", "Recibe comunicaciones por email.")

System_Boundary(slotify, "Slotify — MVP") {

    Container(web_spa, "Frontend SPA", "TypeScript · Vite · React · React Router · Tailwind · shadcn/ui", "Interfaz web del gestor. Gestión de reservas, calendario, presupuestos, facturación y configuración. Cliente HTTP generado desde el contrato OpenAPI del backend.")

    Container(api, "Backend API", "TypeScript · NestJS · Prisma ORM · OpenAPI/Swagger", "Lógica de dominio y casos de uso. Máquina de estados de reservas. Bloqueo atómico de fechas. Generación de PDFs (presupuestos y facturas). Expone contrato REST documentado con OpenAPI.")

    ContainerDb(db, "Base de Datos", "PostgreSQL", "Almacena reservas, clientes, presupuestos, facturas, comunicaciones y configuración por tenant. Row-Level Security (RLS) multi-tenant. Restricción UNIQUE(tenant_id, fecha) para bloqueo atómico contra doble reserva.")

    Container(cron, "Cron / Barrido Periódico", "NestJS Scheduler", "Tarea periódica que barre reservas con TTL vencido, libera fechas bloqueadas, promueve la cola de espera y dispara los recordatorios automáticos. Idempotente y sin estado propio.")

    Container(file_storage, "File Storage", "Supabase Storage / Railway Storage", "Almacena PDFs generados (presupuestos, facturas) y justificantes de pago subidos por el gestor.")
}

System_Ext(email_provider, "Proveedor de Email", "Resend / Postmark. Email transaccional con SPF/DKIM/DMARC.")
System_Ext(error_tracking, "Observabilidad", "Sentry. Captura y trazabilidad de errores en producción.")

Rel(gestor, web_spa, "Accede desde el navegador", "HTTPS")
Rel(web_spa, api, "Llamadas REST cross-origin", "HTTPS / JSON (CORS habilitado)")
Rel(api, db, "Lee y escribe con transacciones ACID", "SQL · Prisma · SELECT FOR UPDATE · puerto 5432")
Rel(api, file_storage, "Sube y descarga PDFs y justificantes", "HTTPS / API")
Rel(api, email_provider, "Envía emails automáticos y manuales (E1–E8)", "HTTPS / API")
Rel(api, error_tracking, "Reporta errores y excepciones", "HTTPS")
Rel(cron, api, "Invoca endpoint protegido de barrido periódico", "HTTP interno")
Rel(api, cliente, "Entrega emails a través del proveedor", "Email (indirecto)")

Lay_R(db, file_storage)

@enduml
```

---

## Nivel 3 — Component (Backend NestJS API)

> Descompone el contenedor Backend API en sus módulos de dominio, siguiendo la organización hexagonal: cada módulo expone controladores HTTP (interface), orquesta casos de uso (application), define entidades y puertos (domain) e implementa adaptadores de infraestructura (infrastructure). Solo se muestra la capa de componentes lógicos para mayor claridad.

```plantuml
@startuml "slotify-c4-component-api"

!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Component.puml

LAYOUT_TOP_DOWN()
LAYOUT_WITH_LEGEND()

title Component Diagram — Backend NestJS API

Container_Ext(web_spa, "Frontend SPA", "Vite · React", "Interfaz del gestor. Genera llamadas a la API.")
ContainerDb_Ext(db, "PostgreSQL", "Base de datos transaccional principal.")
Container_Ext(email_provider, "Proveedor de Email", "Resend / Postmark / SES.")
Container_Ext(file_storage, "File Storage", "PDFs y justificantes de pago.")

Container_Boundary(api, "Backend NestJS API") {

    Component(auth_module, "Auth Module", "NestJS · Passport · JWT · bcrypt", "Autenticación (estrategia local + JWT). Access token de vida corta en memoria del cliente. Refresh token en cookie httpOnly. Tenant y rol en payload firmado. Guards de autorización por rol y tenant.")

    Component(reservas_module, "Reservas Module (M1 — Core)", "NestJS · DDD · Hexagonal · Máquina de estados", "Corazón del sistema. Gestión del ciclo completo de la reserva (16+ transiciones de estado). Bloqueo atómico de fecha via UNIQUE + transacción. Cola de espera y promoción automática. Vínculos entre consultas del mismo cliente (consulta_vinculo).")

    Component(calendario_module, "Calendario Module (M2)", "NestJS", "Consulta de disponibilidad por fecha y rango. Vista de reservas activas y bloqueadas. Soporte de festivos y temporadas configurables por tenant.")

    Component(clientes_module, "Clientes Module (M3)", "NestJS", "Gestión de datos de contacto y facturación asociados a reservas. Detección de clientes recurrentes para vincular consultas.")

    Component(presupuestos_module, "Presupuestos Module (M4)", "NestJS · Puppeteer / react-pdf", "Motor de cálculo de tarifas (temporada, tipo de evento, nº invitados, extras). Generación y versionado de PDFs de presupuesto. Expone plantillas configurables por tenant.")

    Component(facturacion_module, "Facturación Module (M5)", "NestJS · Puppeteer / react-pdf", "Emisión de facturas (señal, liquidación, complementarias). Gestión completa de fianza (cobro, recibo independiente, solicitud IBAN, devolución). Registro de pagos parciales y conciliación.")

    Component(comunicaciones_module, "Comunicaciones Module (M6)", "NestJS", "Plantillas dinámicas de email (E1–E8). Envío automático en transiciones de estado. Envío manual por el gestor. Log de todas las comunicaciones vinculado a la reserva.")

    Component(ficha_evento_module, "Ficha Evento Module (M7)", "NestJS", "Briefing operativo del evento: timing del día, nº invitados final confirmado, menús acordados, contactos de guardia. Consultable por el personal el día del evento.")

    Component(tareas_module, "Tareas Module (M8)", "NestJS", "Sistema de tareas y alertas vinculadas a la reserva. Recordatorios de pagos pendientes, reuniones previas y checklist de preparación.")

    Component(dashboards_module, "Dashboards Module (M10)", "NestJS", "KPIs operativos (ocupación, conversión, pipeline). KPIs financieros (ingresos, cobros pendientes). Consultas sobre el histórico de reservas. Exports CSV.")

    Component(config_module, "Configuración Module (M11)", "NestJS", "Tarifario por temporada y tipo de evento. Plantillas de email y PDF. TTLs de bloqueo y porcentajes de pago. Festivos y atributos del espacio. Aislado por tenant.")

    Component(cron_module, "Cron / Scheduler Module", "NestJS Scheduler", "Barrido periódico de TTLs vencidos. Liberación de fechas bloqueadas. Promoción de la cola de espera. Disparo de emails de recordatorio automáticos. Idempotente: puede ejecutarse múltiples veces sin efecto colateral.")

    Component(openapi, "OpenAPI Contract", "NestJS Swagger", "Documentación viva de todos los endpoints. Utilizado para generar el cliente HTTP type-safe del frontend. Fuente de verdad del contrato front/back.")
}

Rel(web_spa, auth_module, "Login y renovación de access token", "HTTPS / REST")
Rel(web_spa, reservas_module, "CRUD de reservas y transiciones de estado", "HTTPS / REST")
Rel(web_spa, calendario_module, "Consulta disponibilidad y bloqueos", "HTTPS / REST")
Rel(web_spa, clientes_module, "Gestión de datos de cliente", "HTTPS / REST")
Rel(web_spa, presupuestos_module, "Genera y descarga presupuestos PDF", "HTTPS / REST")
Rel(web_spa, facturacion_module, "Emite facturas y registra pagos", "HTTPS / REST")
Rel(web_spa, comunicaciones_module, "Envía emails y consulta log de comunicaciones", "HTTPS / REST")
Rel(web_spa, ficha_evento_module, "Completa y consulta briefing operativo", "HTTPS / REST")
Rel(web_spa, tareas_module, "Gestiona tareas y recordatorios", "HTTPS / REST")
Rel(web_spa, dashboards_module, "Consulta KPIs y exporta datos", "HTTPS / REST")
Rel(web_spa, config_module, "Configura tarifario y preferencias del tenant", "HTTPS / REST")

Rel(auth_module, db, "Valida credenciales y gestiona refresh tokens", "SQL · Prisma")
Rel(reservas_module, db, "Lee/escribe reservas · SELECT FOR UPDATE en bloqueo de fecha", "SQL · Prisma")
Rel(calendario_module, db, "Lee/escribe fechas bloqueadas y disponibilidad", "SQL · Prisma")
Rel(clientes_module, db, "Lee/escribe datos de cliente y vínculos", "SQL · Prisma")
Rel(presupuestos_module, db, "Lee tarifas y escribe presupuestos", "SQL · Prisma")
Rel(presupuestos_module, file_storage, "Sube PDFs de presupuesto generados", "HTTPS / API")
Rel(facturacion_module, db, "Lee/escribe facturas, cobros y fianza", "SQL · Prisma")
Rel(facturacion_module, file_storage, "Sube PDFs de factura y justificantes", "HTTPS / API")
Rel(comunicaciones_module, db, "Registra log de comunicaciones por reserva", "SQL · Prisma")
Rel(comunicaciones_module, email_provider, "Delega el envío de emails transaccionales", "HTTPS / API")
Rel(tareas_module, db, "Lee/escribe tareas y alertas", "SQL · Prisma")
Rel(dashboards_module, db, "Consultas de reporting (read-only)", "SQL · Prisma")
Rel(config_module, db, "Lee/escribe configuración del tenant", "SQL · Prisma")
Rel(cron_module, reservas_module, "Invoca barrido de TTLs y promoción de cola", "Interno")
Rel(cron_module, comunicaciones_module, "Dispara emails de recordatorio automáticos", "Interno")

@enduml
```
