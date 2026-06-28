# Change: us-045-motor-email-automatico

## Why

US-045 (Crítica, talla L, módulo **M10 Comunicaciones**, UC-35) pide que el
sistema envíe el email correcto en cada hito del ciclo de vida de la reserva
(E1–E8) sin intervención del gestor y que **toda** comunicación quede trazada en
`COMUNICACION`. Resuelve **D1** (comunicación reactiva y manual), **D3** (carga
administrativa repetitiva) y **D9** (ausencia de automatización). (Fuente:
`US-045 §Historia`, `§Impacto de Negocio`, UC-35.)

Hoy existe la **deuda DT-EMAIL-01**: US-003 (alta 2.a) y US-004 (alta 2.b/2.d) ya
crean la `COMUNICACION` E1 y disparan el envío a través del **puerto de dominio**
`EnviarEmailPort`, pero su único adaptador es un **STUB no-op** sin red
(`apps/api/src/comunicaciones/infrastructure/enviar-email.stub.adapter.ts`). No hay
transporte real, ni plantillas, ni i18n, ni manejo de fallo/idempotencia. (Fuente:
puerto `enviar-email.port.ts`, módulo `comunicaciones.module.ts`, uso en
`reservas/application/alta-consulta.use-case.ts`.)

### Tensión de alcance (clave, a resolver en el Gate SDD)

La ficha describe E1–E8, pero **solo E1 tiene trigger disponible hoy** (US-003 /
US-004, ya archivadas). E2–E8 dependen de US que **aún no existen**:

| Email | Trigger | US que lo habilita | Estado hoy |
|-------|---------|--------------------|-----------|
| E1 | lead creado (`2.a`/`2.b`) | US-003 / US-004 | **Disponible** |
| E2 | `pre_reserva` activada (+PDF presupuesto) | US-014 | No existe |
| E3 | `reserva_confirmada` + factura señal | US-021/022/023 | No existe |
| E4 | liquidación facturada | US-027/028 | No existe |
| E5 | `post_evento` con `fianza_eur > 0` | US-034 | No existe |
| E6 | sub-estado `2.v` (visita) | US-008 | No existe |
| E7 | resultado visita "interesado" → `2.b` | US-009 | No existe |
| E8 | `iban_devolucion` registrado | US-035 | No existe |

**Resolución propuesta**: el entregable AHORA es el **MOTOR de email reutilizable y
hexagonal** + **cerrar DT-EMAIL-01** (sustituir el STUB por transporte real) +
**cablear E1 de verdad**. E2–E8 quedan **diseñados** (catálogo, contrato de
adjuntos y máquina de triggers preparados) pero su **cableado se difiere** a cada
US futura. Implementar ahora el cableado de E2–E8 sería construir contra triggers,
PDFs y estados que no existen (riesgo de spec especulativa y código muerto).

## What Changes

> Slice vertical de backend (sin cambios de frontend de usuario; la pestaña
> Comunicaciones de la ficha es de US-046). Sujeto al **Gate de revisión humana
> SDD** (decisiones en `design.md`).

### AHORA (se implementa en este change)

- **Motor de email reutilizable hexagonal**: servicio de aplicación
  `DespacharEmailService` (o equiv.) que orquesta *seleccionar plantilla →
  sustituir variables → resolver adjuntos → enviar por el puerto → registrar
  resultado en `COMUNICACION` + `AUDIT_LOG`*. Reutilizable por cualquier trigger
  E1–E8. (Fuente: `US-045 §Historia`.)
- **Adaptador de transporte real** del `EnviarEmailPort` con proveedor
  (**Resend**, ver `design.md §1`), configurado por entorno y con **modo
  sandbox/fake** para CI/QA (no envía correos reales). El **puerto de dominio se
  mantiene** (interfaz pura); solo cambia el adaptador y se extiende el comando con
  campos **opcionales** retro-compatibles (idioma, variables, adjuntos).
- **Catálogo de plantillas** por `codigo_email` + idioma (`TENANT_SETTINGS.idioma`,
  default `es`): E1 **activa**; E2–E8 **registradas como diseñadas/inactivas** (sin
  trigger cableado). (Fuente: `US-045 §Reglas de negocio`, `design.md §3`.)
- **Sustitución de variables** desde `RESERVA` y `CLIENTE` con **validación de
  variable nula**: si falta un campo requerido (p. ej. `CLIENTE.email`), **no se
  envía**, no se crea `COMUNICACION` con `estado='enviado'`, y se registra el error
  en `AUDIT_LOG`. (Fuente: `US-045 §Variable de plantilla nula`.)
- **Interfaz de adjuntos**: contrato del motor para adjuntar documentos por
  referencia (`pdf_url` de `FACTURA`/`DOCUMENTO`/`PRESUPUESTO`); los PDFs reales y
  su cableado llegan con las US de E2/E3/E4. El motor sabe adjuntar; el origen se
  difiere. (Fuente: `US-045 §Reglas de negocio` adjuntos, `§Reglas de Validación`.)
- **Registro en `COMUNICACION`**: `estado='enviado'` + `fecha_envio` no nulo en
  envío correcto; `estado='borrador'` sin `fecha_envio` para E1 con
  comentarios (UC-36 / US-046); `estado='fallido'` sin `fecha_envio` ante error de
  proveedor. (Fuente: `US-045 §Reglas de Validación`.)
- **Idempotencia** por `(reserva_id, codigo_email)`: un trigger genera **una**
  entrada; si se dispara dos veces, el sistema detecta la existente y no duplica el
  envío. Requiere **migración** (índice UNIQUE parcial, ver `design.md §4`).
- **Fallo del proveedor**: `estado='fallido'` + `AUDIT_LOG`, **sin reintento
  automático** en MVP. (Fuente: `US-045 §Fallo del proveedor de email`.)
- **Cablear E1 real (cierre DT-EMAIL-01)**: el flujo de alta (US-003/004) deja de
  usar el STUB y usa el adaptador real; auto-envío si la consulta **no** tiene
  comentarios; **borrador** (estado=`borrador`, sin `fecha_envio`) si tiene
  comentarios. **Regresión cero** sobre US-003/004. (Fuente: `US-045 §Happy Path
  E1`, `§E1 con notas/comentarios`, `design.md §6`.)

### DISEÑADO PERO DIFERIDO (no se cablea en este change)

- **Triggers E2–E8**: el catálogo los contempla como entradas diseñadas/inactivas;
  cada uno se **cablea en su US** (E2→US-014, E3→US-021/022/023, E4→US-027/028,
  E5→US-034, E6→US-008, E7→US-009, E8→US-035). Se documenta como **deuda por US**.
- **Adjuntos reales** (PDF presupuesto/factura/documento): solo la **interfaz** se
  entrega ahora; la generación y el cableado llegan con E2/E3/E4.
- **Patrón estado-en-fila + barrido (cron)**: reservado para los **recordatorios
  programados** (T-15d/T-3d/T-1d, cobro de liquidación/fianza, NPS T+3d) que la
  ficha marca como `📐 Solo diseñado`. No entran en MVP. (Fuente: `US-045 §Notas de
  alcance`, `design.md §2`.)
- **Envío manual del borrador E1** (revisar/editar/confirmar, `codigo_email`
  `manual`): es **UC-36 / US-046**. Aquí solo se crea el borrador.
- **Emails de cola** (entrada/promoción/descarte) y **briefing operativo**:
  `📐 Solo diseñado`, fuera de MVP. (Fuente: `US-045 §Notas de alcance`.)

## Impact

- **Spec afectada**: **nueva capability `comunicaciones`** (motor de email y
  trazabilidad E1–E8). Refina la responsabilidad de envío de E1 que la capability
  `consultas` (US-003) había **diferido explícitamente** a US-045; `consultas` no
  se reescribe (el puerto y el observable de E1 se mantienen).
- **Contrato OpenAPI** (`docs/api-spec.yml`): el motor es **interno** (no expone
  endpoint público nuevo de usuario). No se prevé editar el contrato en este change;
  el `contract-engineer` confirmará tras el gate si UC-35 requiere algún endpoint
  protegido (p. ej. de diagnóstico). El alta E1 ya está en `POST /reservas`.
- **Migración de BD**: **sí** — índice **UNIQUE parcial** sobre
  `comunicacion (reserva_id, codigo_email) WHERE reserva_id IS NOT NULL` para la
  idempotencia. El resto del modelo `COMUNICACION` (US-000) **ya tiene** todos los
  campos necesarios (ver `design.md §5`).
- **Configuración**: nuevas variables de entorno para el proveedor (clave API,
  remitente, modo) validadas en `config/env.validation.ts`. En `test`/CI el modo es
  **fake** (sin red).
- **Código afectado** (implementación posterior, fuera de este change de spec):
  `apps/api/src/comunicaciones/{domain,application,infrastructure}/**` (motor,
  catálogo de plantillas, adaptador Resend + fake, repositorio COMUNICACION),
  `apps/api/src/comunicaciones/comunicaciones.module.ts` (re-binding del puerto),
  `apps/api/src/config/env.validation.ts`, `apps/api/prisma/{schema.prisma,
  migrations}`. La integración con el alta (`reservas/application/
  alta-consulta.use-case.ts`) se mantiene a través del puerto, con cambio mínimo
  para el manejo de fallo post-commit (ver `design.md §6`).
- **Trazabilidad**: **US-045**, **UC-35**; entidades `RESERVA`, `CLIENTE`,
  `COMUNICACION`, `AUDIT_LOG`, `TENANT_SETTINGS` (y `FACTURA`/`DOCUMENTO`/
  `PRESUPUESTO` como orígenes de adjuntos, diferidos); automatizaciones A1–A8 /
  emails E1–E8 (solo E1 cableado).
- **Dependencias**: depende de **US-003/US-004** (trigger E1, ya hechas) y de
  **US-000** (schema). E2–E8 dependen de US futuras (cableado diferido).

## Lo que NO entra (anti-scope)

- Cableado de **triggers E2–E8** (se difiere a sus US; ver tabla arriba).
- **Generación de PDFs** de presupuesto/factura/documento (US de E2/E3/E4).
- **Reintentos automáticos** de envíos fallidos (MVP: sin reintento, solo
  `estado='fallido'` + auditoría). (Fuente: `US-045 §Fallo del proveedor`.)
- **Cron/barrido de recordatorios programados** y **NPS T+3d** (`📐 Solo
  diseñado`). (Fuente: `US-045 §Notas de alcance`.)
- **UI de revisión/envío manual de borradores** (UC-36 / US-046) y **pestaña
  Comunicaciones** de la ficha.
- **Webhooks de entrega/bounce/seguimiento** del proveedor (no pedidos en MVP).

## Decisiones de diseño pendientes de aprobación humana

Las **6 decisiones** (proveedor + sandbox; síncrono vs barrido; plantillas/i18n;
idempotencia/migración; modelo `COMUNICACION`; regresión del STUB) están razonadas
con recomendación en `design.md`. Quedan **abiertas hasta el OK del Gate SDD**.
