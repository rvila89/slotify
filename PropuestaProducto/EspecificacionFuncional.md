# Especificación Funcional Slotify — Plataforma SaaS de Gestión Integral para Espacios Boutique de Eventos Privados

> **Nombre del producto:** *Slotify*
> **Descriptor de marca:** Plataforma de gestión para espacios de eventos
> **Caso piloto MVP:** Masia l'Encís
> **Visión:** Sistema operativo end-to-end para propietarios y gestores de espacios boutique de eventos.
> **Filosofía del modelo de datos:** la **reserva** es la entidad central del producto. Todo lo demás (cliente, presupuesto, factura, comunicaciones) cuelga de ella.
> **Modelo multi-tenant:** un tenant = un espacio. El espacio es implícito en el tenant, no es una entidad independiente. Tenants con múltiples espacios reservables por separado quedan fuera de alcance hasta V3+.
> **Contexto de desarrollo:** Trabajo Final de Máster. Desarrollo asistido por IA con metodologías SDD (Spec-Driven Development) y TDD (Test-Driven Development). Ver §14.
> **Plazos del TFM:** Documentación técnica 12/06/2026 · Código funcional 10/07/2026 · Entrega final 29/07/2026.

---

## Índice

1. [Análisis de dolor actual → problemas operativos](#1-análisis-de-dolor)
2. [Propuesta de valor](#2-propuesta-de-valor)
3. [Arquitectura funcional y modular](#3-arquitectura-funcional)
4. [Flujo completo de una reserva (lead → cierre)](#4-flujo-end-to-end)
5. [Pipeline de estados de reserva](#5-pipeline-de-estados)
6. [Automatizaciones clave](#6-automatizaciones)
7. [Dashboards operativo, financiero e histórico](#7-dashboards)
8. [Diferenciadores vs CRM genéricos](#8-diferenciadores)
9. [Roadmap priorizado (MVP → V2 → Premium)](#9-roadmap)
10. [Stack tecnológico recomendado](#10-stack)
11. [Recomendaciones UX/UI específicas del sector](#11-uxui)
12. [Ventajas competitivas reales](#12-ventajas-competitivas)
13. [Riesgos y decisiones abiertas](#13-riesgos)
14. [Metodología de desarrollo (SDD + TDD asistido por IA) y bitácora](#14-metodología)

---

## 1. Análisis de dolor

Traducción literal de cada punto a problema operativo medible. Cada feature del producto debe trazar a uno de estos dolores.

| # | Dolor actual | Problema operativo concreto | Coste/Riesgo |
|---|---|---|---|
| D1 | Gestión en Gmail + Sheets + WhatsApp | No hay *single source of truth*. La misma reserva vive en 4 sitios y se desincroniza. | Errores, retrabajo, decisiones con datos obsoletos |
| D2 | No se sabe en qué punto está cada consulta | Cero visibilidad del pipeline. Imposible priorizar follow-ups. | Leads perdidos por falta de seguimiento |
| D3 | Sin estados claros de reserva | Confusión entre pre-reserva vs reserva pagada vs confirmada. | Doble reserva, expectativas mal alineadas |
| D4 | Riesgo de doble reserva | No hay bloqueo atómico de fecha. | **Crítico**: impacto reputacional + indemnizaciones |
| D5 | Sin histórico centralizado y consultable de reservas | No se pueden consultar reservas pasadas de forma estructurada. | Pérdida de memoria operativa, decisiones sin datos históricos |
| D6 | Facturación dispersa | Facturas en Drive sueltas, sin conciliación con cobros. | Errores fiscales, retrasos en cobros |
| D7 | Sin dashboards | Decisiones por intuición, no por datos. | No se detectan caídas de ocupación a tiempo |
| D8 | Presupuestos manuales | 30–60 min por presupuesto, copy-paste propenso a errores. | Tiempo perdido + errores de cálculo |
| D9 | Sin automatizaciones | Cada email, recordatorio y seguimiento se hace a mano. | Tareas repetitivas absorben al equipo |
| D10 | Sin fichas organizadas | Briefing del evento esparcido en hilos de email y WhatsApp. | El día del evento se trabaja con info incompleta |
| D11 | Sin recordatorios estructurados | Pagos atrasados no se detectan, reuniones previas se olvidan. | Cash flow + experiencia cliente |
| D12 | Clientes que vuelven a contactar tras expirar una consulta se gestionan como nuevos | Se pierde contexto del intento anterior. El gestor pregunta cosas que el cliente ya respondió. | Fricción innecesaria, mala experiencia, KPIs distorsionados |
| D13 | Cuando una fecha está bloqueada por otra consulta, los nuevos leads se pierden o se gestionan manualmente con seguimiento ad-hoc | El gestor no tiene forma estructurada de poner leads "en cola" ni de avisar automáticamente cuando se libera una fecha. Se pierden oportunidades comerciales o se generan promesas verbales no trazables. | Pérdida de leads + riesgo reputacional por compromisos no formalizados |

**Insight clave:** los dolores D2, D3, D4, D5 y D8 son los que más fricción diaria generan. El MVP debe atacar estos *primero*.

**Nota sobre el modelo conceptual:** la entidad central del producto es **la reserva**, no el cliente. Los datos del cliente son atributos de la reserva (a quién contactar, a quién facturar). Esto refleja la realidad del negocio: la mayoría de clientes en eventos privados son no recurrentes, pero el histórico de reservas es el activo informacional clave.

---

## 2. Propuesta de valor

**Para** propietarios y gestores de espacios boutique de eventos (masías, fincas, villas, jardines, salones familiares)
**que** hoy gestionan su operación con Gmail + Sheets + Drive + WhatsApp,
**Slotify es** una plataforma operativa especializada
**que** unifica el ciclo completo de un evento (lead → consulta → presupuesto → reserva → ejecución → archivo) y conserva un histórico centralizado y consultable de todas las reservas,
**a diferencia de** CRMs genéricos (HubSpot, Pipedrive) o herramientas hoteleras (PMS) que no entienden la lógica de un evento privado,
**nuestro producto** elimina el riesgo de doble reserva, automatiza el 80% de las comunicaciones y presupuestos, maximiza oportunidades comerciales mediante cola automática de leads en fechas bloqueadas, y entrega visibilidad operativa, financiera e histórica en tiempo real.

**Una frase de venta:** *"Gestiona toda tu masía desde un solo lugar. Cero dobles reservas, presupuestos en 30 segundos, ningún lead perdido, y todo el histórico siempre a un clic."*

---

## 3. Arquitectura funcional

### 3.1 Visión modular

```
┌─────────────────────────────────────────────────────────────────┐
│                         SLOTIFY                                 │
│          Plataforma de gestión para espacios de eventos         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│         ┌─────────────────────────────────────────┐             │
│         │   [M1] RESERVA (entidad central)        │             │
│         │   Pipeline · Histórico · Ficha · Estado │             │
│         │   · Vínculos · Cola de espera           │             │
│         └─────────────────────────────────────────┘             │
│                                                                 │
│  [M2] Calendario     [M3] Datos de       [M4] Presupuestos      │
│       & Disponibilid.     Cliente (attr)      & Tarifas         │
│                                                                 │
│  [M5] Facturación   [M6] Comunicaciones  [M7] Ficha operativa   │
│       & Cobros           (Email/PDF/WA)       del Evento        │
│                                                                 │
│  [M8] Tareas &       [M9] Proveedores    [M10] Dashboards       │
│       Recordatorios       & Catering           & Reporting      │
│                                                                 │
│  [M11] Configuración  [M12] Multi-tenant                        │
│        & Tarifario          & Permisos                          │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  Plataforma transversal: Auth, Audit log, Notifications,        │
│  Backups, API, Integraciones (Stripe, calendarios, contabilidad)│
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Descripción de cada módulo

| Módulo | Responsabilidad principal | Resuelve dolores |
|---|---|---|
| **M1 — Reservas: Pipeline, Histórico, Ficha y Cola** | Crear, mover entre estados, consultar y archivar cualquier reserva. **Histórico consultable.** **Detección y vínculo automático de leads recurrentes.** **Gestión de cola de espera en fechas bloqueadas.** Es el corazón del producto. | D2, D3, D5, D12, **D13** |
| **M2 — Calendario & Disponibilidad** | Vista visual mensual/semanal con bloqueos atómicos por fecha. | D4 |
| **M3 — Datos de Cliente** | Datos de contacto y facturación asociados a una o varias reservas. No es un CRM; es un repositorio de atributos del cliente para usar dentro del flujo de la reserva. | D1 (parcial), D12 |
| **M4 — Presupuestos & Tarifas** | Motor de cálculo de tarifas (por temporada, tipo de evento, nº invitados, extras). Generación PDF. | D8 |
| **M5 — Facturación & Cobros** | Generar facturas (señal, liquidación, complementarias, fianza), registrar pagos parciales, conciliar. **Gestión de fianzas:** cobro antes o el mismo dia del evento, recibo independiente, solicitud de IBAN post-evento, devolución. | D6 |
| **M6 — Comunicaciones** | Plantillas dinámicas de email, PDF y (futuro) WhatsApp Business. Logs por reserva. | D1, D9 |
| **M7 — Ficha operativa del Evento** | Briefing completo del evento: timing, nº invitados final, menús, contactos, planos. | D10 |
| **M8 — Tareas & Recordatorios** | Sistema de tasks y alertas vinculadas a la reserva. | D11 |
| **M9 — Proveedores & Catering** | Directorio de proveedores recurrentes y asociación con eventos. | (V1/V2) |
| **M10 — Dashboards** | KPIs operativos, financieros e históricos. Exports CSV. | D7, D5 |
| **M11 — Configuración** | Tarifario, plantillas, atributos del espacio del tenant, temporadas, festivos, TTLs, porcentajes de pago. | Transversal |
| **M12 — Multi-tenant & Permisos** | Aislamiento de datos entre tenants (cada tenant = un espacio). Roles (admin, gestor, operario). | Transversal |

### 3.3 Naming público de módulos

Para comunicación externa, documentación de usuario y UI, cada módulo funcional tiene un nombre comercial coherente con la marca Slotify:

| Módulo técnico | Nombre público | Descripción corta |
|----------------|----------------|-------------------|
| M1 — Reservas | **Slotify Flow** | Pipeline completo de reservas |
| M2 — Calendario | **Slotify Calendar** | Disponibilidad y bloqueos |
| M3 — Datos de Cliente | **Slotify Contacts** | Directorio de clientes |
| M4 — Presupuestos | **Slotify Quote** | Generación de presupuestos |
| M5 — Facturación | **Slotify Pay** | Facturación y cobros |
| M6 — Comunicaciones | **Slotify Connect** | Emails y notificaciones |
| M7 — Ficha operativa | **Slotify Brief** | Briefing del evento |
| M8 — Tareas | **Slotify Tasks** | Recordatorios y alertas |
| M9 — Proveedores | **Slotify Partners** | Directorio de proveedores |
| M10 — Dashboards | **Slotify Insights** | KPIs y reporting |
| M11 — Configuración | **Slotify Settings** | Tarifario y preferencias |
| M12 — Multi-tenant | *(interno)* | No expuesto en UI |

> **Nota arquitectónica:** aunque el MVP solo sirve a un tenant (Masia l'Encís), el modelo de datos debe ser multi-tenant desde el día 1. Reescribir esto después es prohibitivo. Detalle en §10.

### 3.4 Modelo conceptual de entidades

```
                    ┌─────────────────┐
                    │     RESERVA     │  ◄── Entidad central
                    │  (id, estado,   │      Mantiene 3 sub-procesos
                    │   sub-procesos: │      paralelos en fase 4+:
                    │   pre_evento,   │      - pre_evento_status
                    │   liquidacion,  │      - liquidacion_status
                    │   fianza)       │      - fianza_status
                    │                 │
                    │  campos cola:   │
                    │  - posicion_cola│
                    │  - consulta_    │
                    │    bloqueante_id│
                    └────────┬────────┘
                             │
                             │ ◄── puede estar vinculada a otra(s)
                             │     reserva(s) anteriores del mismo
                             │     cliente (consulta_vinculo)
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
  ┌──────────┐         ┌──────────┐         ┌──────────┐
  │  CLIENTE │         │  PRESU-  │         │  FICHA   │
  │ (datos   │         │  PUESTO  │         │  EVENTO  │
  │ contacto │         │  (PDF,   │         │ (timing, │
  │ y factu- │         │  versio- │         │  menús,  │
  │ ración)  │         │  nado)   │         │  invita-)│
  └──────────┘         └──────────┘         └──────────┘
        │                    │                    │
        ▼                    ▼                    ▼
  ┌──────────┐         ┌──────────┐         ┌──────────┐
  │ FACTURAS │         │ PAGOS &  │         │ TAREAS & │
  │ (señal,  │         │ JUSTIFI- │         │ RECORD.  │
  │ liquid., │         │ CANTES   │         │          │
  │ comple.) │         │          │         │          │
  └──────────┘         └──────────┘         └──────────┘
                             │
                             ▼
                       ┌──────────┐
                       │  COMUNIC.│
                       │ (emails, │
                       │ logs, WA)│
                       └──────────┘


Tabla auxiliar consulta_vinculo:
┌───────────────────────────────────────────────────────────────┐
│ consulta_nueva_id  | consulta_anterior_id | motivo | fecha   │
│ (FK reserva)       | (FK reserva)         |        |         │
└───────────────────────────────────────────────────────────────┘
Permite trazabilidad N:M entre intentos del mismo cliente.

Campos en RESERVA para gestión de cola:
- posicion_cola: int | null      (no nulo solo si sub_estado = 2.d)
- consulta_bloqueante_id: FK | null (apunta a la consulta que bloquea la fecha)

Campos en RESERVA para gestión de fianza:
- fianza_eur: decimal | null         (importe de fianza cobrada; null si no aplica)
- fianza_cobrada_fecha: date | null  (fecha en que se cobró la fianza)
- fianza_devuelta_fecha: date | null (fecha en que se devolvió la fianza)
- fianza_devuelta_eur: decimal | null (importe devuelto; puede ser parcial por desperfectos)

Campos en CLIENTE para devolución de fianza:
- iban_devolucion: string | null     (IBAN proporcionado por cliente para devolución de fianza)

Campos en RESERVA para visita:
- visita_programada_fecha: date | null  (fecha/hora acordada para la visita)
- visita_realizada: bool | null         (true si la visita se realizó)
```

**Reglas del modelo:**
- Un cliente no puede existir sin al menos una reserva asociada. Si un cliente recurrente reaparece, se crea una nueva reserva que referencia al cliente existente.
- El cliente nunca es el punto de entrada de la navegación.
- **Las consultas son entidades inmutables.** Una consulta expirada nunca cambia de estado. Si el cliente vuelve, se crea una nueva consulta vinculada a la anterior.
- **La cola es FIFO y se modela mediante el campo `posicion_cola`** en la propia entidad reserva, sin tabla auxiliar.
- **Solo una consulta puede tener una fecha bloqueada blanda activa.** Las demás esperan en cola apuntando a ella via `consulta_bloqueante_id`.
- **La unidad de bloqueo es `fecha`** (no `(fecha, espacio)`), ya que cada tenant tiene un único espacio.

### 3.4 Modelo de tarifas (motor de cálculo de presupuestos)

Modelo basado en el tarifario de Masia l'Encís: **3 temporadas × 3 tramos horarios × 5 tramos de invitados = 45 entradas de tarifa precalculada**, más 2 extras opcionales.

```
TABLA: tarifa
─────────────
- id (PK)
- tenant_id (FK)
- temporada (enum: alta, media, baja)
- duracion_horas (int: 4, 8, 12)
- invitados_min (int)
- invitados_max (int)
- precio_total_eur (decimal, IVA 21% incluido)
- vigente_desde (date)
- vigente_hasta (date | null)

TABLA: temporada_calendario
───────────────────────────
- id (PK)
- tenant_id (FK)
- temporada (enum: alta, media, baja)
- mes (int: 1-12)

Configuración Masia l'Encís:
- Alta: mayo, junio, julio, agosto, septiembre
- Media: marzo, abril, octubre, noviembre
- Baja: diciembre, enero, febrero

TABLA: extra
────────────
- id (PK)
- tenant_id (FK)
- nombre (string: "Barbacoa", "Paellero")
- precio_eur (decimal: 30.00)
- activo (bool)
```

**Lógica de cálculo del presupuesto:**

```
1. Input: fecha_evento, duracion_horas, num_invitados_para_tarifa, extras[]
2. Determinar temporada según mes de fecha_evento (consulta temporada_calendario)
3. Buscar tarifa donde:
   - temporada coincide
   - duracion_horas coincide
   - num_invitados_para_tarifa entre invitados_min e invitados_max
   - tarifa vigente en fecha_evento
4. Si no encuentra (num_invitados > 50) → marcar como "tarifa a consultar"
   y permitir al gestor introducir precio manual
5. Sumar precios de los extras seleccionados
6. Total = precio_tarifa + suma_extras
```

**Reglas operativas:**

- **Niños hasta 4 años: gratuitos.** La ficha de la reserva tiene dos campos separados: `num_adultos_y_ninos_mayores_4` (cuenta para tarifa) y `num_ninos_menores_4` (informativo, no afecta tarifa).
- **>50 invitados:** fallback manual. El sistema no calcula automáticamente; el gestor introduce precio.
- **Versionado de tarifas:** los presupuestos generados quedan congelados con la tarifa vigente en el momento de generación. Si la tarifa cambia después, NO se recalcula el presupuesto enviado.
- **IVA:** los precios del dossier ya incluyen IVA al 21%. La factura desglosa base imponible + IVA.

---

## 4. Flujo end-to-end

### 4.1 Diagrama de flujo

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ 1. Lead         │ ──► │ 2. Consulta     │ ──► │ 3. Pre-reserva  │
│ Web/email/WApp  │     │ Bloqueo 3 días  │     │ Bloqueo 7 días  │
│ (detec. recurr.)│     │ (condicional)   │     │ Presupuesto OK  │
│ (chequeo cola)  │     │ (cola si aplica)│     │                 │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                                                         ▼
                                                ┌─────────────────┐
                                                │ 4. Confirmada   │
                                                │ Señal 40%       │
                                                └────────┬────────┘
                                                         │
                              ┌──────────────────────────┴────────┐
                              │                                   │
                              ▼                                   ▼
                    ┌─────────────────┐               ┌─────────────────┐
                    │ 5. Pre-evento   │               │ 6. Liquidación  │
                    │ Briefing, menús │               │ 60% restante    │
                    │ deadline T-1d   │               │ deadline T-1d   │
                    └────────┬────────┘               └────────┬────────┘
                              │                                │
                              └────────────────┬───────────────┘
                                               │
                                  Precondición: ambos cerrados
                                               │
                                               ▼
                                      ┌─────────────────┐
                                      │ 7. Día evento   │
                                      │ Ejecución       │
                                      └────────┬────────┘
                                               │
                                               ▼
                                      ┌─────────────────┐
                                      │ 8. Post-evento  │
                                      │ NPS, reseñas    │
                                      └────────┬────────┘
                                               │
                                               ▼
                                      ┌─────────────────┐
                                      │ 9. Archivo en   │
                                      │ histórico       │
                                      └─────────────────┘
```

**Notas clave del flujo:**
- En el paso 1 se ejecutan dos chequeos automáticos: **detección de cliente recurrente** (ver §4.3) y **chequeo de disponibilidad de fecha** (ver §4.4).
- Los pasos 5 y 6 corren **en paralelo** desde la confirmación de la reserva hasta T-1d.
- El paso 7 tiene como **precondición** que ambos sub-procesos estén cerrados.
- El paso 2 tiene **sub-estados internos** que rigen si la fecha está bloqueada o no, y si la consulta está en cola.

### 4.2 Sub-estados internos del paso 2 (Consulta)

| Sub-estado | Descripción | Bloqueo de fecha |
|---|---|---|
| **2.a — consulta_exploratoria** | El cliente pregunta sin fecha concreta | No bloquea |
| **2.b — consulta_con_fecha** | El cliente indica una fecha concreta y está disponible | Bloqueo blando 3 días |
| **2.c — consulta_pendiente_invitados** | El cliente confirma fecha pero falta nº de invitados | Bloqueo extendido +3 días |
| **2.d — consulta_en_cola** | El cliente pidió una fecha que ya está bloqueada por otra consulta en 2.b. Espera a que se libere. | No bloquea (apunta a la consulta bloqueante) |
| **2.v — consulta_visita_programada** | El cliente solicita visita al espacio antes de decidir. El gestor programa la visita (máx. 7 días desde solicitud) y bloquea la fecha. | Bloqueo blando hasta día posterior a la visita `[CONFIG]` |
| **2.x — consulta_expirada** | TTL agotado sin avance. **Estado terminal.** Las reaperturas crean entidad nueva vinculada. | No bloquea |
| **2.y — consulta_descartada_por_cola** | La fecha quedó tomada por otra consulta (la bloqueante avanzó a 2.c o pre-reserva). **Estado terminal.** | No bloquea |
| **2.z — consulta_descartada_por_cliente** | El cliente indicó explícitamente que no le interesa esperar o continuar. **Estado terminal.** | No bloquea |

### 4.2.1 Gestión de leads multi-canal

**Canales de entrada en MVP:** Formulario web de Masia l'Encís, Email directo, Instagram, WhatsApp y Llamadas telefónicas.

En el **MVP**, toda entrada de lead se gestiona como **alta manual del gestor** en la herramienta, independientemente del canal de origen. El formulario web no tiene integración directa con Slotify: cuando un potencial cliente lo rellena, el gestor recibe la información (vía email o notificación) y la introduce manualmente en el formulario normalizado de la herramienta. El sistema aplica igualmente la detección de recurrencia y el chequeo de disponibilidad en todos los casos.

**Formulario normalizado de alta de lead en la herramienta:**

El gestor introduce los datos del lead mediante este formulario normalizado en Slotify, independientemente del canal por el que llegó. Los campos opcionales permiten calcular la tarifa y determinan el comportamiento del email de respuesta:

| Campo | Tipo | Impacto en el sistema |
|---|---|---|
| Nombre y apellidos | **Obligatorio** | Identificación del lead |
| Email | **Obligatorio** | Detección de recurrencia; comunicaciones |
| Teléfono | **Obligatorio** | Canal de contacto alternativo |
| Canal de entrada | **Obligatorio** | Selector: Formulario web · Email directo · Instagram · WhatsApp · Llamada telefónica. Se almacena en la consulta para atribución de leads en dashboards y KPIs. No afecta al flujo ni al comportamiento del email E1. |
| Fecha del evento | Opcional | Si presente → sub-estado inicial **2.b** (si fecha libre); si ausente → sub-estado **2.a**. **El selector de fecha solo permite fechas ≥ hoy. El sistema bloquea en UI la introducción de fechas pasadas.** |
| Nº aprox. de invitados | Opcional | Si presente + fecha + horas → permite calcular tarifa exacta |
| Horas de evento (4 / 8 / 12) | Opcional | Si presente + fecha + invitados → permite calcular tarifa exacta |
| Comentarios / notas adicionales | Opcional | **Si presente → email queda en borrador para revisión del gestor** |

**Lógica que determina el sub-estado inicial de la consulta y el comportamiento del email E1:**

Los campos que el gestor rellena en el formulario normalizado determinan tanto el **sub-estado inicial de la consulta** como el comportamiento del **email de respuesta inicial (E1)**, sea cual sea el canal de origen del lead:

```
Gestor da de alta el lead en la herramienta
  │
  ├─ ¿Tiene campo COMENTARIOS rellenado?
  │   └── SÍ → Email E1 queda en BORRADOR
  │             El gestor puede editarlo y confirma el envío manualmente
  │             Sub-estado según campos de fecha (ver ramas inferiores)
  │
  └─ NO → Evaluar campos completados:
           │
           ├─ fecha + nº invitados + horas → SUB-ESTADO 2.b
           │                                 EMAIL AUTO-ENVIADO con tarifa estimada
           │
           ├─ fecha + solo obligatorios    → SUB-ESTADO 2.b
           │                                 EMAIL AUTO-ENVIADO sin precio exacto,
           │                                 adjuntando dossier de tarifas
           │
           └─ sin fecha                    → SUB-ESTADO 2.a
                                             EMAIL AUTO-ENVIADO con dossier general
```

**Nota de diseño:** el campo de comentarios es la señal de que el lead tiene necesidades específicas o ha formulado preguntas que requieren respuesta personalizada. En esos casos el sistema genera el borrador del email con los datos disponibles, pero el gestor lo revisa, edita si es necesario, y confirma el envío. En el resto de casos el sistema envía automáticamente sin intervención del gestor.

**Recomendación sobre el formulario web de Masia l'Encís:**

Para facilitar la captura de datos estructurados y reducir el trabajo manual del gestor, se recomienda añadir al formulario web los campos opcionales (fecha, nº de invitados, horas y comentarios/notas) junto a los campos actuales obligatorios (nombre y apellidos, email, teléfono). Con esta mejora, el gestor puede trasladar directamente los datos del email recibido al formulario normalizado de la herramienta sin tener que extraer información de un campo de texto libre.


### 4.3 Detección de cliente recurrente

Cuando entra un nuevo lead (paso 1), el sistema ejecuta automáticamente esta lógica antes de crear la consulta:

```
Nuevo lead entra
  │
  ▼
Normalizar email del lead (minúsculas, sin espacios)
  │
  ▼
¿Existe alguna reserva previa con mismo email_normalized en este tenant?
  │
  ├── No → flujo estándar (continúa al chequeo de disponibilidad §4.4)
  │
  └── Sí → analizar estado de la(s) reserva(s) previa(s):
        │
        ├── Si alguna está en estado ACTIVO
        │   (consulta viva, pre_reserva, reserva_confirmada, etc.)
        │   → ALERTA al gestor: "Este cliente ya tiene una reserva activa [ID]"
        │   → NO crear consulta nueva automáticamente
        │   → Decisión manual del gestor
        │
        └── Si TODAS están en estado TERMINAL
            (consulta_expirada, descartadas, reserva_cancelada, reserva_completada)
            → Continuar al chequeo de disponibilidad (§4.4)
            → Al crear la consulta: vincular con la(s) anterior(es) via consulta_vinculo
            → Pre-rellenar datos heredados (nombre, teléfono, tipo evento)
              marcados como "heredados, requiere confirmación"
            → Banner en la UI: "Cliente recurrente — N intentos previos"
            → Tag automático en la consulta: "recurrente"
```

**Criterio de identificación:**
- **Principal:** email normalizado idéntico
- **Fallback (V1):** teléfono normalizado a E.164
- **Manual:** el gestor puede vincular/desvincular consultas desde la UI

### 4.4 Chequeo de disponibilidad de fecha y gestión de cola

**Precondición:** la fecha ya ha sido validada como ≥ hoy en el formulario de alta de lead (§4.2.1). El selector de fecha bloquea en UI la introducción de fechas pasadas; este flujo nunca recibe una fecha anterior al día actual.

Cuando se va a crear una consulta con fecha concreta, el sistema comprueba el estado actual de la fecha solicitada:

```
Lead con fecha concreta entra
  │
  ▼
¿Cuál es el estado actual de la fecha en este tenant?
  │
  ├── LIBRE
  │     → Crear consulta en sub-estado 2.b
  │     → Bloqueo blando 3 días [CONFIG]
  │     → Email respuesta inicial + tarifa estimada
  │
  ├── BLOQUEADA por consulta en 2.b
  │     → Crear consulta en sub-estado 2.d (en cola)
  │     → Asignar posicion_cola = max(posicion_cola actual) + 1
  │     → Marcar consulta_bloqueante_id = ID de la consulta en 2.b
  │     → Email automático al cliente: "La fecha está bloqueada por otra
  │       consulta hasta el [fecha+3d]. Te hemos puesto en cola
  │       (posición N). Si la fecha se libera, te avisaremos
  │       automáticamente. Esto no supone ningún compromiso por nuestra
  │       parte; te recomendamos explorar otras fechas en paralelo.
  │       [Botón: Salir de la cola]"
  │
  ├── BLOQUEADA por consulta en 2.c
  │     → Crear consulta en sub-estado 2.a (exploratoria, sin cola)
  │     → Email: "La fecha solicitada no está disponible en este momento.
  │       ¿Quieres explorar fechas alternativas?"
  │     → (Razón: 2.c indica que el cliente bloqueante ya ha dado su
  │       palabra de seguir adelante; confiamos en que termine en reserva)
  │
  ├── BLOQUEADA por pre_reserva (3)
  │     → Crear consulta en sub-estado 2.a (exploratoria, sin cola)
  │     → Email: "La fecha solicitada no está disponible.
  │       ¿Quieres explorar alternativas?"
  │
  └── BLOQUEADA por reserva_confirmada o estados posteriores
        → Crear consulta en sub-estado 2.a (exploratoria, sin cola)
        → Email: "Lamentablemente la fecha solicitada ya está reservada.
          ¿Quieres explorar otras fechas?"
```

**Reglas clave de la cola:**
1. **Solo se activa cola si la fecha está bloqueada por una consulta en 2.b.** El tiempo máximo de espera en cola está acotado a 3 días (TTL del bloqueo 2.b).
2. **FIFO ilimitada:** primer llegado, primer servido. No hay límite de personas en cola.
3. **Sin prioridad por recurrencia:** un cliente recurrente que entre en cola NO tiene prioridad sobre otros leads.
4. **Cola por fecha exacta:** no se sugiere entrada en cola para fechas próximas.

### 4.5 Comportamiento de la cola según evolución de la consulta bloqueante

| Evento sobre la consulta bloqueante | Acción del sistema sobre la cola |
|---|---|
| **Bloqueante expira (2.b → 2.x)** | Promover automáticamente al primero en cola (posición 1) a sub-estado 2.b con TTL fresco de 3 días. Reordenar la cola: el resto sube una posición y actualiza su `consulta_bloqueante_id` apuntando al nuevo bloqueante. Email al promovido: "¡La fecha está disponible! La hemos bloqueado para ti 3 días." Email opcional al resto informando del cambio de posición. |
| **Bloqueante avanza a 2.c** | Vaciar toda la cola. Las consultas en cola pasan a estado terminal `consulta_descartada_por_cola` (2.y). Email a cada uno: "Lamentablemente la fecha ha sido tomada por otro cliente. ¿Quieres explorar alternativas?" |
| **Bloqueante avanza a 2.b → 3 (pre_reserva)** | Mismo comportamiento: vaciar toda la cola y descartar a 2.y. |
| **Bloqueante cancela manualmente** | Promover al primero en cola, igual que en expiración. |

**Encadenamiento automático de promociones:**
Si una consulta promovida (que estaba en cola y pasa a 2.b) también expira sin respuesta del cliente, el sistema promueve automáticamente al siguiente en cola. Este encadenamiento es completamente automático y no requiere intervención del gestor.

### 4.6 Comportamiento del cliente en cola

El cliente que está en cola tiene una sola acción explícita disponible:

- **Salir de la cola voluntariamente:** desde el botón "Salir de la cola" en el email que recibió. La consulta pasa a estado terminal `consulta_descartada_por_cliente` (2.z) y la cola se reordena (los siguientes suben una posición).

Si el cliente no hace nada, simplemente espera. Solo recibirá otro email si:
- Es promovido a 2.b (fecha liberada).
- La cola se vacía (fecha tomada por la bloqueante).

### 4.7 User stories por paso

| # | Actor | Acción | Resultado esperado |
|---|---|---|---|
| 1 | Cliente potencial | Envía email/rellena form web | Lead entra al sistema. Sistema ejecuta detección de recurrencia y chequeo de disponibilidad. Si la fecha está bloqueada por 2.b → consulta entra en cola (2.d). Si está bloqueada por 2.c o posteriores → consulta exploratoria (2.a). |
| 2.a | Gestor | Revisa consulta exploratoria y propone fechas | Email enviado con opciones de fecha y tarifa estimada; ninguna fecha bloqueada todavía |
| 2.b | Gestor / Sistema | Detecta fecha concreta disponible | Fecha bloqueada 3 días automáticamente; email de respuesta inicial |
| 2.c | Gestor | Cliente confirma fecha pero falta nº invitados | Bloqueo extendido 3 días más; email solicitando información faltante. **Si hay consultas en cola, se vacían y notifican.** |
| 2.d | Sistema | Cliente pide fecha bloqueada por otra consulta en 2.b | Consulta creada en cola con posición asignada; email informativo con CTA "Salir de la cola" |
| 2.v | Gestor | Cliente solicita visita al espacio antes de decidir | Gestor acepta y programa visita (máx. 7 días desde solicitud); fecha bloqueada hasta día posterior a la visita; email al cliente confirmando fecha/hora. Tras la visita: si interesa → 2.b o 3; si no → 2.z |
| 3 | Gestor | Cliente confirma toda la info; se hace pre-reserva | Fecha bloqueada 7 días; presupuesto PDF generado y enviado. **Si hay consultas en cola sobre esa fecha, se vacían y notifican.** |
| 4 | Gestor | Recibe justificante de señal y lo sube al sistema | Estado pasa a `reserva_confirmada`. **Generación y envío de factura de señal (40%) adjunta en email de confirmación.** Fecha bloqueada en firme. Activan en paralelo sub-procesos 5, 6 y 6b. |
| 5 | Gestor + Cliente | Trabajan colaborativamente la ficha del evento (T-Xd → T-1d) | Ficha completa: menús, timing, invitados, proveedores. Cliente recibe recordatorios automáticos. |
| 6 | Gestor | Recibe justificante del importe restante (deadline T-1d) | Liquidación marcada como cobrada. **Generación y envío de factura de liquidación (60% + extras).** |
| 6b | Gestor | Recibe justificante de fianza (deadline T-0, día del evento) | Fianza marcada como cobrada. **Envío de recibo de fianza.** El cliente puede pagar antes del evento o el mismo día. Es un pago a parte de la liquidación |
| 7 | Gestor + equipo | Ejecutan el evento (solo si 5, 6 cerrados) | Briefing recibido; vista móvil "evento en curso" activa |
| 8 | Sistema | Cierre del expediente y NPS | **Si hay fianza cobrada → solicitud automática de IBAN al cliente para devolución.** NPS enviada a T+3d; devolución de fianza cuando se recibe IBAN |
| 9 | Sistema | Reserva pasa al histórico consultable | Disponible en búsqueda, filtros y reporting |

### 4.8 Automatizaciones

> **Convención:** `[CONFIG]` marca valores fijos en MVP que en V2 podrán configurarse por tenant.

#### Transiciones entre estados

**1 → 2.a / 2.b / 2.d: Lead entrante** (alta manual del gestor a partir de cualquier canal; ver §4.2.1)
- En MVP toda entrada de lead es **alta manual** del gestor.
- **Detección automática de cliente recurrente por email normalizado** (ver §4.3)
- Si recurrente con reserva activa → alerta y NO se crea consulta automáticamente
- Si recurrente con todas las reservas en estado terminal → continuar y vincular al crear
- **Chequeo de disponibilidad de fecha** (ver §4.4) → determina el sub-estado de entrada:
  - Fecha libre → 2.b con bloqueo blando 3 días `[CONFIG]`
  - Fecha bloqueada por 2.b → 2.d (en cola) con posición asignada
  - Fecha bloqueada por 2.c, pre_reserva o estados posteriores → 2.a
  - Sin fecha concreta → 2.a
- Cálculo automático de tarifa estimada según tarifario vigente (en 2.d, el cálculo también se hace y se envía en el correo dónde se indica que la fecha está bloqueada y pasa a la cola, de esa forma ya sabe los precios y decide si espera o sale de la cola)
- **Email de respuesta (E1):** el comportamiento depende exclusivamente de los campos rellenados en el formulario normalizado de la herramienta (ver §4.2.1), independientemente del canal de origen del lead. Auto-envío si campos suficientes y sin comentarios; borrador para revisión y confirmación del gestor si hay comentarios.

**2.a → 2.b: Cliente indica fecha concreta y está libre**
- Bloqueo blando de la fecha (TTL: 3 días) `[CONFIG]`
- Email al cliente confirmando el bloqueo provisional

**2.a / 2.b → 2.v: Cliente solicita visita al espacio antes de decidir**
- Gestor acepta la solicitud y programa fecha/hora de visita (máximo 7 días desde la solicitud) `[CONFIG]`
- Bloqueo blando de la fecha solicitada hasta el día posterior a la visita programada
- Registro de `visita_programada_fecha` en la reserva
- Email al cliente: "Hemos programado tu visita a [espacio] el [fecha] a las [hora]. La fecha del evento queda bloqueada provisionalmente hasta el día posterior a tu visita."
- Recordatorio automático al gestor el día de la visita

**2.v → 2.b: Visita realizada, cliente confirma interés**
- Gestor marca `visita_realizada = true`
- Cambio de sub-estado a 2.b
- Reset del TTL de bloqueo: 3 días frescos desde la visita `[CONFIG]`
- Email al cliente: "¡Gracias por visitarnos! Hemos mantenido tu fecha bloqueada 3 días más para que confirmes."

**2.v → 3: Visita realizada, cliente quiere reservar de inmediato** (si info completa)
- Gestor marca `visita_realizada = true`
- Si el cliente proporciona toda la info (fecha, nº invitados, tipo evento), puede saltar directamente a pre_reserva
- Cambio de estado a `pre_reserva`
- Reset del bloqueo de la fecha (TTL: 7 días) `[CONFIG]`
- Generación automática de presupuesto PDF
- Envío del presupuesto por email con instrucciones de pago de la señal (40%)

**2.v → 2.z: Visita realizada, cliente descarta**
- Gestor marca `visita_realizada = true` y registra que el cliente no está interesado
- Cambio de sub-estado a 2.z (consulta_descartada_por_cliente)
- Liberación de la fecha
- Email al cliente: "Gracias por visitarnos. Si cambias de opinión, estamos a tu disposición."

**2.v → 2.x: Bloqueo de visita agotado sin realizarse**
- El día posterior a la visita programada, si no se ha marcado como realizada
- O bien, día +7 desde la solicitud si no se ha programado visita aún
- Cambio de sub-estado a 2.x (consulta_expirada)
- Liberación de la fecha
- Notificación al gestor
- Email al cliente: "Tu bloqueo provisional ha expirado. Contáctanos si aún te interesa."

**2.d → 2.b: Promoción desde cola** (automática cuando la bloqueante expira a 2.x, o manual por el gestor)
- Asignar bloqueo blando de la fecha (TTL: 3 días desde la promoción) `[CONFIG]`
- Limpiar `posicion_cola` y `consulta_bloqueante_id` (poner a null)
- Calcular tarifa estimada
- Email al cliente promovido: "¡La fecha del [X] está disponible! La hemos bloqueado provisionalmente para ti durante 3 días."
- Reordenación automática del resto de la cola (los siguientes suben una posición y actualizan `consulta_bloqueante_id` al ID de la consulta recién promovida)
- **Override manual disponible (ver §6.3):** el gestor puede promover manualmente cualquier consulta de la cola (no solo la primera), reordenar posiciones, o vaciar la cola completa desde la UI. Cada acción manual genera el mismo comportamiento automático posterior (emails, bloqueos, reordenación).

**2.a / 2.b → 2.c: Cliente confirma fecha pero falta nº de invitados final**
- Extensión del bloqueo por 3 días adicionales `[CONFIG]`
- Email al cliente: "Mantenemos tu fecha 3 días más mientras confirmas el nº de invitados"
- **Si la consulta tenía cola asociada (era una 2.b con cola): vaciar la cola.** Todas las consultas en cola apuntando a esta pasan a `consulta_descartada_por_cola` (2.y) con email de notificación.

**2.a / 2.b / 2.c → 3: Gestor activa la pre-reserva** (acción manual explícita)
- **La transición a `pre_reserva` es siempre una acción manual del gestor**, activada mediante el botón "Generar presupuesto" en la ficha de la consulta. Requiere que el cliente haya confirmado: fecha, nº de invitados y tipo de evento. La transición NO ocurre automáticamente.
- Cambio de estado a `pre_reserva`
- Reset del bloqueo de la fecha (TTL: 7 días desde la transición) `[CONFIG]`
- Generación automática del presupuesto PDF (borrador editable; el gestor puede revisar y ajustar antes de enviar)
- Envío del presupuesto por email con instrucciones de pago de la señal (40%) `[CONFIG]`
- **Si la consulta tenía cola asociada: vaciar la cola** (caso poco frecuente porque normalmente la cola ya se vació en la transición a 2.c, pero se contempla por si se salta directamente de 2.b a 3).

**3 → 4: Gestor confirma recepción del justificante de señal** (subida manual del adjunto)
- Cambio de estado a `reserva_confirmada`
- Bloqueo definitivo de la fecha (sin TTL)
- **Generación automática de factura de señal** (40% del presupuesto aceptado)
- Generación automática de checklist pre-evento
- Creación de la ficha operativa del evento (vacía, lista para rellenar)
- **Envío de email de confirmación al cliente con factura de señal adjunta**, resumen y próximos hitos

**4 → (5 + 6 + 6b en paralelo): Reserva confirmada**
- Activación de TRES sub-procesos paralelos independientes:
  - Sub-proceso "pre-evento" (5): apertura del periodo de definición del evento
  - Sub-proceso "liquidación" (6): programación de la factura de liquidación (deadline T-1d)
  - Sub-proceso "fianza" (6b): programación del cobro de fianza (deadline T-0)
- Email al cliente con resumen, próximos hitos y calendario de pagos (señal ya cobrada, liquidación antes de T-1d, fianza hasta el día del evento)

**5: Pre-evento** (sub-proceso interno, ventana T-Xd → T-1d)
- Cumplimentación progresiva de la ficha operativa del evento
- Sub-proceso cerrado cuando el gestor marca "ficha cerrada" o automáticamente a T-1d

**6: Liquidación** (sub-proceso interno, deadline T-1d)
- Al inicializar el subproceso:
  - Cálculo automático de la liquidación (presupuesto base + ajustes acumulados − señal cobrada)
  - Generación de factura de liquidación en PDF (60% + extras; borrador para revisión humana)
  - Recordatorio al gestor para revisar y enviar
- Gestor revisa y envía la factura de liquidación al cliente
- Gestor confirma cobro del 60% restante (subida manual del justificante)
- Sub-proceso cerrado

**6b: Fianza** (sub-proceso interno, deadline T-0 — día del evento)
- Al inicializar el subproceso:
  - Cálculo de fianza según configuración del tenant (`fianza_default_eur`) `[CONFIG]`
  - Generación de recibo de fianza independiente (marcado como "depósito reembolsable")
  - Recordatorio al gestor para enviar recibo al cliente
- Gestor envía recibo de fianza al cliente (puede ser junto con la liquidación o por separado)
- El cliente puede pagar la fianza:
  - Junto con la liquidación (días antes del evento)
  - El mismo día del evento (antes del inicio)
- Gestor confirma cobro de fianza (subida manual del justificante)
- Registro de `fianza_eur` y `fianza_cobrada_fecha` en la reserva
- Sub-proceso cerrado

**(5 + 6 + 6b) → 7: Día del evento**
*Precondición:* `pre_evento_status = cerrado AND liquidacion_status = cobrada AND fianza_status = cobrada`
- Cambio de estado a `evento_en_curso`
- Envío del briefing operativo en PDF al equipo
- Activación de la vista móvil "evento en curso" para el equipo
- Si la precondición no se cumple → ver §4.9 "Política de liquidación tardía"

**7 → 8: Gestor marca el evento como finalizado**
- Cambio de estado a `post_evento`
- **Si la reserva tiene fianza cobrada (`fianza_eur` > 0):**
  - Solicitud automática de IBAN al cliente para devolución
  - Email: "El evento ha finalizado. Para devolverte la fianza, indícanos tu IBAN."
- (Opcional) Si hay ajustes posteriores → generación de factura complementaria
- Programación de la encuesta NPS a T+3d

**8 → 9: T+7d del evento o cierre administrativo completo** `[CONFIG]`
- Cambio de estado a `reserva_completada`
- Archivo automático de la reserva en histórico consultable
- Indexación full-text para búsqueda
- (Opcional) Email de agradecimiento con petición de reseña en Google

#### Automatizaciones internas a cada estado

**Dentro de 2.a (consulta_exploratoria, sin bloqueo):**
- Día +5 sin respuesta → email recordatorio: "¿Aún te interesa? Cuéntanos qué fecha tienes en mente"
- Día +10 sin respuesta → marcar consulta como "fría" + notificar al gestor

**Dentro de 2.b (consulta_con_fecha, bloqueo 3 días):**
- Día +2 sin respuesta → email: "Tu bloqueo de fecha expira mañana"
- Día +3 sin respuesta (TTL agotado):
  - Liberación automática de la fecha
  - Cambio de sub-estado a 2.x (consulta_expirada)
  - **Promoción automática del primero en cola, si existe** (ver §4.5)
  - Notificación al gestor
- **Override manual disponible (ver §6.3):** el gestor puede extender el TTL antes de que expire, acortarlo, o cambiar manualmente el sub-estado de la consulta. También puede pausar los recordatorios automáticos para esta consulta específica.

**Dentro de 2.c (consulta_pendiente_invitados, +3 días):**
- Día +2 desde la extensión sin respuesta → email: "Tu bloqueo de fecha expira mañana"
- Día +3 desde la extensión (TTL agotado):
  - Liberación de la fecha + cierre como `consulta_expirada` + notificación al gestor
  - (No hay cola que promover, porque al pasar a 2.c se vació)

**Dentro de 2.d (consulta_en_cola, sin TTL propio):**
- No tiene automatizaciones temporales propias. Su evolución depende exclusivamente de los cambios en la consulta bloqueante.
- Cliente puede pulsar "Salir de la cola" en cualquier momento → pasa a 2.z + reordenación de la cola.

**Dentro de 2.v (consulta_visita_programada, bloqueo hasta día post-visita)** `[CONFIG]`:
- Día de la visita → recordatorio al gestor: "Hoy tienes visita programada con [cliente] a las [hora]"
- Día posterior a la visita sin marcarla como realizada → alerta al gestor: "Ayer tenías visita con [cliente]. ¿Se realizó?"
- Día +1 post-visita (bloqueo agotado) sin visita marcada como realizada:
  - Liberación automática de la fecha
  - Cambio de sub-estado a 2.x (consulta_expirada)
  - Notificación al gestor + email al cliente
- Si pasan 7 días desde la solicitud sin programar visita → expiración automática a 2.x

**Dentro de 3 (pre_reserva, bloqueo 7 días)** `[CONFIG]`:
- Día +3 sin justificante de señal → recordatorio amable al cliente
- Día +6 sin justificante → segundo recordatorio + aviso de expiración inminente
- Día +7 sin justificante (TTL agotado):
  - Liberación automática de la fecha
  - Cambio de estado a `reserva_cancelada` (motivo: "no pago de señal")
  - Notificación al gestor + email al cliente

**Dentro de 4 (reserva_confirmada):**
- Inmediatamente al entrar → email al cliente confirmando reserva

**Dentro de 5 (Pre-evento)** `[CONFIG: ventanas configurables por tenant]`:
- Email al cliente: confirmar nº invitados final, menú, timing detallado
- T-7d → alerta al gestor si la ficha del evento está incompleta
- T-3d → generación y envío del briefing PDF al equipo + email recordatorio al cliente con info logística
- T-1d → resumen al cliente con info de último minuto + cierre automático de la ficha (read-only)

**Dentro de 6 (Liquidación)** `[CONFIG: deadline T-1d]`:
- Generación de factura en borrador + alerta al gestor para revisión
- Tras envío de factura:
  - Día +3 sin pago → recordatorio amable al cliente
  - Día +7 sin pago → segundo recordatorio + alerta al gestor
- T-2d sin pago → ALERTA MÁXIMA: deadline mañana
- T-1d sin pago (deadline incumplido) → activación de "Política de liquidación tardía" (§4.9)

**Dentro de 6b (Fianza)** `[CONFIG: deadline T-0]`:
- Al inicializar → generación de recibo de fianza + alerta al gestor para enviar al cliente
- El gestor puede enviar el recibo de fianza:
  - Junto con la factura de liquidación (recomendado)
  - Por separado, más cerca del evento
- T-3d sin pago de fianza → recordatorio al cliente: "Recuerda que la fianza debe estar abonada antes del evento"
- T-1d sin pago de fianza → ALERTA al gestor: "Fianza pendiente para mañana"
- T-0 (día del evento) sin pago:
  - El cliente puede pagar en el momento (antes del inicio del evento)
  - Si el evento inicia sin fianza cobrada → activación de "Política de fianza tardía" (§4.9b)

**Dentro de 7 (evento_en_curso):**
- Sin automatizaciones temporales; registro manual de incidencias y consumos por el equipo

**Dentro de 8 (post_evento):**
- **Si hay fianza cobrada:**
  - Inmediatamente al entrar → email al cliente solicitando IBAN para devolución de fianza
  - T+3d sin IBAN recibido → recordatorio al cliente
  - T+7d sin IBAN recibido → segundo recordatorio + alerta al gestor
  - Cuando cliente proporciona IBAN → registro en `iban_devolucion` + alerta al gestor para procesar devolución
  - Gestor marca fianza como devuelta (subida justificante transferencia) → registro de `fianza_devuelta_fecha` y `fianza_devuelta_eur`
- T+3d → envío email de gratitud y de encuesta NPS al cliente
- T+5d → propuesta automática de cierre administrativo al gestor si no quedan acciones pendientes (incluyendo devolución de fianza)

### 4.9 Política de liquidación tardía (deadline T-1d incumplido)

Si la liquidación no se ha cobrado a T-1d, el sistema bloquea automáticamente el paso al estado `evento_en_curso` y activa una de estas políticas:

| Política | Comportamiento | Recomendación |
|---|---|---|
| **Estricta** | Cancelación automática a T-1d. Pérdida de señal. | Tenants con alta demanda |
| **Negociable** | Bloqueo del paso + alerta crítica al gestor | **Default recomendado en MVP** |
| **Flexible** | El evento procede; liquidación queda como cobro post-evento | Solo para clientes recurrentes/de confianza |

En **MVP**: única política **"Negociable"**. Configurable por tenant a partir de **V2**.

### 4.9b Política de fianza tardía (deadline T-0 incumplido)

Si la fianza no se ha cobrado cuando el evento debe iniciar (T-0), el sistema aplica una de estas políticas:

| Política | Comportamiento | Recomendación |
|---|---|---|
| **Estricta** | El evento no puede iniciar hasta que se cobre la fianza | Para espacios con política de fianza obligatoria |
| **Negociable** | Alerta crítica al gestor. Decisión manual de proceder o no. | **Default recomendado en MVP** |
| **Flexible** | El evento procede; fianza queda como cobro durante/post-evento. Se puede cobrar en efectivo al llegar. | Para clientes de confianza |

En **MVP**: única política **"Negociable"** (igual que liquidación). Configurable por tenant a partir de **V2**.

---

## 5. Pipeline de estados

### 5.1 Máquina de estados jerárquica

```
RESERVA (entidad)
│
├── consulta
│   ├── 2.a · consulta_exploratoria        (sin fecha, sin bloqueo)
│   ├── 2.b · consulta_con_fecha           (bloqueo 3d)
│   ├── 2.c · consulta_pendiente_invitados (bloqueo extendido +3d)
│   ├── 2.d · consulta_en_cola             (esperando, apunta a bloqueante)
│   ├── 2.v · consulta_visita_programada   (bloqueo hasta día post-visita)
│   │
│   └── [Estados TERMINALES de consulta]
│       ├── 2.x · consulta_expirada               (TTL agotado, inmutable)
│       ├── 2.y · consulta_descartada_por_cola    (fecha tomada por bloqueante)
│       └── 2.z · consulta_descartada_por_cliente (cliente salió voluntariamente)
│
├── pre_reserva                            (bloqueo 7d, presupuesto enviado)
│
├── reserva_confirmada                     (señal cobrada)
│   │
│   └── [SUB-PROCESOS PARALELOS, activos hasta T-0]
│       │
│       ├── pre_evento_status (deadline T-1d)
│       │   ├── pendiente
│       │   ├── en_curso
│       │   └── cerrado
│       │
│       ├── liquidacion_status (deadline T-1d)
│       │   ├── pendiente
│       │   ├── facturada
│       │   └── cobrada
│       │
│       └── fianza_status (deadline T-0, día del evento)
│           ├── pendiente
│           ├── recibo_enviado
│           └── cobrada
│
├── evento_en_curso                        (precondición: los 3 sub-procesos cerrados)
│
├── post_evento                            (evento finalizado, NPS programada)
│
├── reserva_completada                     (archivo en histórico, TERMINAL)
│
└── reserva_cancelada                      (TERMINAL, con motivo registrado)
```

**Regla de inmutabilidad:** los estados terminales (`2.x`, `2.y`, `2.z`, `reserva_completada`, `reserva_cancelada`) son inmutables. No se reabren ni cambian de estado. Si el cliente vuelve, se crea una nueva entidad reserva vinculada via `consulta_vinculo`.

### 5.2 Tabla de estados y transiciones

| Estado | Significado | Disponibilidad de la fecha | Quién lo dispara | Trigger automático al entrar |
|---|---|---|---|---|
| `consulta.2.a` | Lead sin fecha concreta o con fecha no disponible | Libre / N/A | Cliente / gestor / sistema (si fecha bloqueada por 2.c+) | Email respuesta inicial + tarifa estimada |
| `consulta.2.b` | Lead con fecha concreta disponible | Bloqueada blanda 3d | Cliente / gestor / promoción desde cola | Bloqueo + email confirmando fecha pre-bloqueada |
| `consulta.2.c` | Falta nº invitados | Bloqueada blanda +3d | Gestor | Email solicitando info faltante + **vaciado de cola asociada** |
| `consulta.2.d` | En cola, esperando liberación de fecha | No bloquea | Sistema (auto al crear lead) | Email informativo de cola + posición |
| `consulta.2.v` | Visita programada, esperando realización | Bloqueada blanda hasta día post-visita | Gestor (acepta solicitud de visita) | Email confirmando visita programada + recordatorio al gestor |
| `consulta.2.x` | TTL agotado (TERMINAL) | Libre | Sistema | Email al cliente + notificación gestor + **promoción de cola si existe** |
| `consulta.2.y` | Fecha tomada por bloqueante (TERMINAL) | N/A | Sistema (auto cuando bloqueante avanza) | Email al cliente: "fecha ya no disponible, ¿alternativas?" |
| `consulta.2.z` | Cliente salió de cola voluntariamente (TERMINAL) | N/A | Cliente (CTA en email) | Reordenación automática de cola |
| `pre_reserva` | Presupuesto enviado | Bloqueada blanda 7d | Gestor | Presupuesto PDF + email + **vaciado de cola asociada** |
| `reserva_confirmada` | Señal cobrada | Bloqueada firme | Gestor (subida justificante) | **Factura de señal (40%)** + activación sub-procesos paralelos |
| `evento_en_curso` | Día del evento | Bloqueada histórica | Sistema (00:00 fecha evento) | Briefing al equipo + vista móvil |
| `post_evento` | Evento finalizado | Bloqueada histórica | Gestor | **Solicitud IBAN si hay fianza** + NPS programada |
| `reserva_completada` | Archivo final (TERMINAL) | Bloqueada histórica | Sistema (T+7d o cierre admin) | Indexación full-text para histórico |
| `reserva_cancelada` | Cancelada (TERMINAL) | Libre | Gestor / Sistema (TTL) | Aplicar política de cancelación + archivar |

### 5.3 Transiciones permitidas

```
consulta.2.a ──► consulta.2.b ──► consulta.2.c ──► pre_reserva ──► reserva_confirmada
     │                │                │                │                  │
     │                │                │                │                  │
     ├──► consulta.2.v ──► consulta.2.b  │                │                  │
     │        │              │        │                │                  │
     │        └─► expirada(2.x)       │                │                  │
     │        └─► descartada(2.z)     │                │                  │
     │                │                │                │                  │
     │                ▼                │                │                  │
     │           expirada (2.x)       │                │                  │
     │                │                ▼                ▼                  │
     │                │            expirada(2.x)   cancelada               │
     │                │                                                    │
     └──► descartada (2.y/2.z)                                              │
                                                                           │
                                                                           ▼
                                         ┌──[sub-procesos paralelos]──┐
                                         │  pre_evento + liquidacion  │
                                         └──────────┬─────────────────┘
                                                    │
                                       (ambos cerrados)
                                                    ▼
                                          evento_en_curso ──► post_evento ──► reserva_completada
                                                                  │
                                                                  ▼
                                                             cancelada (siempre alcanzable)


Transiciones específicas de la cola:
─────────────────────────────────────
consulta.2.d ──► consulta.2.b   (promoción automática cuando bloqueante expira)
consulta.2.d ──► consulta.2.y   (cuando bloqueante avanza a 2.c o pre_reserva)
consulta.2.d ──► consulta.2.z   (cliente sale voluntariamente)

NOTA: desde cualquier estado TERMINAL no hay transición de salida.
      Las "reaperturas" crean una entidad nueva vinculada via consulta_vinculo.
```

### 5.4 Edge cases

1. **Doble lead sobre la misma fecha concreta:** ahora se gestiona automáticamente vía cola (ver §4.4). Solo si la bloqueante está en 2.b. Si está en 2.c o posteriores, segundo lead va a 2.a.
2. **TTL de pre-reserva expira:** sistema vuelve la fecha a libre + notifica al gestor.
3. **Cobro de señal por transferencia (no Stripe):** flujo manual; gestor sube el justificante.
4. **Cancelación tras pago:** aplicar política configurable. Reserva queda archivada con motivo.
5. **Cambio de fecha de reserva confirmada:** transacción atómica que libera la antigua y bloquea la nueva. Audit log obligatorio.
6. **Reserva de varios días consecutivos:** el bloqueo es un rango.
7. **Bloqueo interno del propietario:** estado especial `bloqueo_interno` para uso familiar o mantenimiento.
8. **Reservas históricas importadas:** se crean en estado `reserva_completada` directamente.
9. **Cliente que paga la liquidación pero después aparecen ajustes:** factura complementaria en post-evento.
10. **Pre-evento cerrado pero liquidación no cobrada en T-1d:** ver §4.9.
11. **Liquidación cobrada pero pre-evento no cerrado en T-1d:** cierre automático forzado de la ficha con datos disponibles.
12. **Cliente recurrente con consulta activa:** alerta al gestor; NO se crea nueva consulta automáticamente. Decisión manual.
13. **Cliente recurrente con todas sus reservas en estado terminal:** se crea consulta nueva vinculada automáticamente; datos pre-rellenados como "heredados, requiere confirmación".
14. **Cliente vuelve sin email (solo llamada telefónica):** el gestor puede vincular manualmente la nueva consulta a un intento anterior buscando por nombre/teléfono.
15. **Email coincide pero el cliente dice que es otra persona** (ej. email familiar compartido): el gestor puede romper el vínculo desde la UI.
16. **Mismo cliente, ya tiene reserva activa y pide OTRA fecha** (segundo evento legítimo): consulta nueva independiente. Tag "cliente con múltiples reservas".
17. **Cliente recurrente desde un email DIFERENTE al original** (ej. cambió de email): la detección automática falla. El gestor debe vincular manualmente cuando lo identifique. *Caso conocido sin solución automática en MVP.*
18. **Encadenamiento de promociones en cola:** R001 expira → R002 promovida → R002 también expira sin respuesta → R003 promovida automáticamente. Encadenamiento completamente automático.
19. **Race condition al crear consulta sobre fecha libre:** dos leads casi simultáneos. El primero entra en 2.b; el segundo detecta fecha bloqueada y entra en 2.d. La transacción de bloqueo debe ser atómica (`SELECT ... FOR UPDATE` o equivalente).
20. **Cliente promovido decide salir de la cola justo cuando se promueve:** transacción atómica. Si la consulta ya no está en 2.d cuando se intenta promover, el sistema busca al siguiente en cola.
21. **Cliente recurrente entra y la fecha está en cola:** se aplican ambas mecánicas: detección de recurrencia + cola. Banner de recurrente + entrada en 2.d.
22. **Cliente en cola se vuelve recurrente posteriormente** (la primera consulta en cola pasa a 2.y, y semanas después vuelve a contactar): caso de detección de recurrencia normal. La nueva consulta se vincula a la 2.y anterior.
23. **Visita programada pero cliente no aparece:** gestor puede reprogramar la visita (dentro del límite de 7 días desde solicitud original) o cerrar como 2.x (expirada). El nuevo bloqueo será hasta el día posterior a la nueva fecha de visita. Decisión manual.
24. **Visita realizada pero cliente pide tiempo para decidir:** transición estándar a 2.b con TTL de 3 días. El cliente ya vio el espacio; ahora tiene 3 días para confirmar.
25. **Visita realizada y cliente quiere reservar de inmediato:** si hay toda la info (fecha, nº invitados, tipo evento), puede saltar directamente a pre_reserva. Transición 2.v → 3 permitida si info completa.
26. **Cliente en cola (2.d) solicita visita:** NO permitido. Primero debe ser promovido a 2.b (fecha disponible) para poder solicitar visita. Mientras está en cola, no tiene bloqueo sobre la fecha.
27. **Cliente no proporciona IBAN para devolución de fianza:** recordatorios automáticos a T+3d y T+7d. Si no responde, el gestor puede contactar manualmente. La reserva no puede cerrarse administrativamente hasta que se resuelva (fianza devuelta o descartada con motivo).
28. **Fianza parcialmente devuelta por desperfectos:** gestor introduce `fianza_devuelta_eur` < `fianza_eur` con nota de motivo. Se genera documento justificativo del descuento.
29. **Cliente proporciona IBAN erróneo:** la transferencia falla. Gestor marca "IBAN inválido" y solicita nuevo IBAN al cliente.
30. **Cancelación tras pago de fianza pero antes del evento:** aplicar política de cancelación. Si procede devolución de fianza, solicitar IBAN igualmente.

---

## 6. Automatizaciones

### 6.1 Top 27 automatizaciones de alto impacto

| # | Trigger | Acción automática | Dolor resuelto | Tiempo ahorrado | Override manual |
|---|---|---|---|---|---|
| A1 | Lead entra | Detección recurrencia + chequeo disponibilidad + crear consulta (2.a, 2.b o 2.d según corresponda) + email respuesta | D2, D9, **D12**, **D13** | ~12 min | E1: auto-envío si campos suficientes y sin comentarios; borrador editable para el gestor si hay comentarios (ver §4.2.1). La lógica aplica igual sea cual sea el canal de origen |
| A2 | Gestor activa pre-reserva | Generar PDF presupuesto (borrador) + email con instrucciones de señal (40%) + **vaciado de cola asociada si existe** | D8, D9, **D13** | ~45 min | Gestor puede editar presupuesto antes de enviar. La transición en sí es siempre manual |
| A3 | Día +2 en `consulta.2.b` sin respuesta | Recordatorio amable al cliente | D11 | 5 min × varios leads/sem | Gestor puede pausar recordatorios para esta consulta (ver §6.3) |
| A4 | Día +3 en `consulta.2.b` sin respuesta (TTL agotado) | Liberar fecha + notificar gestor + **promoción automática del primero en cola** | D4, D11, **D13** | Previene leads perdidos | Gestor puede extender/acortar TTL manualmente antes de que expire (ver §6.3) |
| A5 | Día +7 en `pre_reserva` sin justificante | Liberar fecha + cancelar reserva + notificar | D4, D11 | Previene doble reserva | Gestor puede extender TTL manualmente antes de que expire (ver §6.3) |
| A6 | Gestor sube justificante de señal | Pasar a `reserva_confirmada` + **generar factura de señal (40%) en borrador** + activar sub-procesos paralelos + checklist | D3, D6, D9 | ~20 min | Gestor revisa y aprueba la factura de señal antes del envío al cliente |
| A7 | Inicio sub-proceso liquidación | Generar factura de liquidación en borrador + alerta al gestor | D6, D9 | ~20 min | Gestor revisa y aprueba la factura antes del envío al cliente |
| A7b | Inicio sub-proceso fianza | Generar recibo de fianza en borrador + alerta al gestor para enviar al cliente | D6, D9 | ~10 min | Gestor decide cuándo enviar el recibo al cliente |
| A8 | Inicio sub-proceso pre-evento | Email al cliente confirmando nº invitados, menú, timing | D11 | 15 min | Gestor puede pausar email para esta reserva (ver §6.3) |
| A9 | T-3d del evento | Briefing PDF al equipo + email logístico al cliente | D10, D11 | 30 min | Gestor puede pausar email para esta reserva (ver §6.3) |
| A10 | T-1d del evento | Resumen al cliente + cierre automático de ficha pre-evento | D11 | 10 min | Gestor puede cerrar la ficha manualmente antes de T-1d |
| A11 | Evento marcado completado | **Solicitud IBAN si hay fianza** + programar NPS a T+3d + factura complementaria si aplica | D6, D9 | 15 min | — (accionado por gestor) |
| A12 | T+7d post-evento | Archivo automático en histórico consultable + indexación | D5, D9 | 10 min | Gestor puede archivar manualmente antes de T+7d (ver §6.3) |
| A13 | Lead entra con email conocido del tenant | Detección de cliente recurrente + vínculo automático + pre-relleno de datos + banner UI | D12 | ~10 min por reapertura | Gestor puede desvincular manualmente |
| A14 | Lead entra con fecha bloqueada por 2.b | Crear consulta en 2.d + asignar `posicion_cola` + email informativo + CTA "Salir de la cola" | D13 | ~15 min por lead | — |
| A15 | Consulta bloqueante 2.b expira (→ 2.x) | Promocionar primera consulta en cola a 2.b + email "fecha disponible" + reordenar cola + actualizar referencias `consulta_bloqueante_id` | D13 | Automático | Gestor puede promover manualmente cualquier posición de la cola (ver §6.3) |
| A16 | Consulta bloqueante avanza a 2.c o pre_reserva | Vaciar toda la cola → consultas a `consulta_descartada_por_cola` (2.y) + email a cada uno | D13 | Automático | Gestor puede vaciar la cola manualmente en cualquier momento (ver §6.3) |
| A17 | Cliente pulsa "Salir de la cola" | Pasar consulta a `consulta_descartada_por_cliente` (2.z) + reordenar cola | D13 | Automático | Gestor puede forzar la salida de cualquier consulta de la cola desde la UI (ver §6.3) |
| A18 | Gestor acepta solicitud de visita | Crear consulta en 2.v + bloqueo hasta día post-visita + email confirmando visita programada + recordatorio gestor | D2, D9 | ~10 min | — (accionado por gestor) |
| A19 | Día de la visita programada | Recordatorio al gestor: "Hoy tienes visita con [cliente]" | D11 | Automático | Gestor puede pausar recordatorios para esta consulta (ver §6.3) |
| A20 | Día posterior a la visita sin marcar realizada | Alerta al gestor: "Ayer tenías visita con [cliente]. ¿Se realizó?" | D11 | Automático | Gestor puede pausar alertas para esta consulta (ver §6.3) |
| A21 | Día +1 post-visita (bloqueo agotado) | Liberar fecha + pasar a 2.x + notificar gestor + email cliente | D4, D11 | Automático | Gestor puede extender el bloqueo de visita manualmente antes de que expire (ver §6.3) |
| A21b | Día +7 desde solicitud sin programar visita | Expiración automática → 2.x + liberar fecha + notificar gestor + email cliente | D4, D11 | Automático | Gestor puede reprogramar la visita dentro del límite de 7 días desde la solicitud |
| A22 | Cliente proporciona IBAN en post_evento | Registrar IBAN + alerta al gestor para procesar devolución de fianza | D6, D9 | ~5 min | — |
| A23 | T+3d post-evento sin IBAN recibido | Recordatorio al cliente solicitando IBAN | D11 | Automático | Gestor puede pausar recordatorios para esta reserva (ver §6.3) |
| A24 | T+7d post-evento sin IBAN recibido | Segundo recordatorio cliente + alerta al gestor | D11 | Automático | Gestor puede pausar recordatorios para esta reserva (ver §6.3) |
| A25 | T-3d sin pago de fianza | Recordatorio al cliente: "Recuerda que la fianza debe estar abonada antes del evento" | D11 | Automático | Gestor puede pausar recordatorios para esta reserva (ver §6.3) |
| A26 | T-1d sin pago de fianza | ALERTA al gestor: "Fianza pendiente para mañana" | D11 | Automático | — |

### 6.2 Automatizaciones de soporte

- **Parser de emails entrantes:** convierte un email a `info@masia.com` en una ficha de consulta estructurada (LLM para extraer fecha, nº invitados, tipo de evento). Revisable por el gestor.
- **Sincronización a Google Calendar:** push read-only para el propietario.
- **Recordatorios de pagos pendientes:** dashboard + email diario.
- **Indexación del histórico:** al pasar a estado terminal, se indexa para búsqueda full-text por nombre, fecha, tipo de evento, importe.
- **Detección de recurrencia:** búsqueda indexada por `email_normalized` en cada nueva consulta. Latencia objetivo: <100ms.
- **Chequeo de disponibilidad de fecha:** consulta indexada por `(tenant_id, fecha_solicitada)` con bloqueo transaccional. Latencia objetivo: <50ms.

### 6.3 Acciones manuales de override

El sistema está diseñado para que la mayoría de tareas puedan ejecutarse o anularse manualmente por el gestor. Esto es necesario porque no todos los procesos pueden automatizarse: muchas decisiones operativas requieren criterio humano (relación con el cliente, contexto que el sistema no tiene, excepciones al flujo estándar).

**Principio general:** todas las acciones automáticas son por defecto el camino optimizado, pero el gestor siempre tiene la última palabra. Las acciones manuales quedan registradas en el audit log con el usuario y el motivo si se especifica.

#### Overrides sobre estados y sub-estados

| Acción manual | Descripción | Restricciones |
|---|---|---|
| **Cambiar sub-estado de consulta** | El gestor puede mover una consulta a cualquier sub-estado válido (2.a ↔ 2.b ↔ 2.c, o marcar directamente como 2.x/2.z) desde la ficha de la consulta | No se puede entrar en estados terminales desde un estado terminal |
| **Extender TTL de bloqueo de fecha** | En cualquier consulta con bloqueo activo (2.b, 2.c, 2.v, pre_reserva), el gestor puede extender el TTL antes de que expire | La extensión se hace en días enteros; el sistema registra la nueva fecha de expiración y reprograma los recordatorios |
| **Acortar TTL de bloqueo de fecha** | El gestor puede acortar el TTL o liberar la fecha inmediatamente (equivale a expirar la consulta antes de tiempo) | Requiere confirmación; desencadena las mismas consecuencias que una expiración normal (promoción de cola, emails, etc.) |
| **Archivar reserva antes de T+7d** | En `post_evento`, el gestor puede marcar la reserva como `reserva_completada` sin esperar al automático de T+7d | Solo posible si no hay acciones pendientes (fianza devuelta o descartada) |
| **Forzar transición a `evento_en_curso`** | Si la precondición (sub-procesos cerrados) no se cumple, el gestor puede forzar el inicio del evento con alerta de advertencia | Requiere confirmación explícita; queda registrado en audit log |

#### Overrides sobre la cola de leads

| Acción manual | Descripción |
|---|---|
| **Promover cualquier consulta de la cola** | El gestor puede promover a cualquier posición de la cola (no solo la primera) a 2.b. El sistema reordena automáticamente el resto de la cola y envía los emails correspondientes |
| **Reordenar posiciones** | El gestor puede cambiar el orden de las consultas en cola mediante drag-and-drop en la vista de fecha con cola |
| **Forzar salida de cola de una consulta** | El gestor puede sacar a cualquier lead de la cola, lo que pasa la consulta a 2.z y reordena la cola |
| **Vaciar toda la cola** | El gestor puede vaciar la cola completa de una fecha, enviando a todas las consultas a 2.y (descartadas por cola) |

#### Overrides sobre emails y recordatorios

| Acción manual | Descripción |
|---|---|
| **Pausar recordatorios automáticos** | El gestor puede pausar todos o alguno de los recordatorios automáticos de una consulta o reserva concreta. La pausa es hasta fecha específica o indefinida |
| **Reactivar recordatorios pausados** | El gestor puede reactivar recordatorios pausados en cualquier momento |
| **Enviar email manualmente** | El gestor puede enviar cualquier email del flujo en cualquier momento desde la ficha de la consulta/reserva, independientemente del estado |
| **Revisar borrador antes de enviar** | Cualquier email generado automáticamente puede visualizarse como borrador y editarse antes del envío final |
| **Reenviar email** | El gestor puede reenviar cualquier email ya enviado desde el log de comunicaciones de la reserva |

#### Overrides sobre documentos (facturas y presupuestos)

| Acción manual | Descripción |
|---|---|
| **Revisar y aprobar factura de señal** | La factura de señal generada automáticamente se presenta en borrador; el gestor la revisa y aprueba antes del envío al cliente |
| **Revisar y aprobar factura de liquidación** | Igual que la señal: borrador → revisión → aprobación → envío |
| **Editar presupuesto antes de enviar** | El presupuesto PDF generado automáticamente es editable (cantidades, extras, descuentos) antes del envío |
| **Generar factura complementaria** | El gestor puede generar manualmente facturas complementarias para ajustes post-evento |

---

## 7. Dashboards

### 7.1 Dashboard operativo (pantalla por defecto)

| Widget | Contenido | Por qué |
|---|---|---|
| Hoy y mañana | Eventos del día y siguiente, con responsables | Operativa inmediata |
| Pipeline | Consultas (con sub-estado), pre-reservas, confirmadas | Visibilidad pipeline |
| Sub-procesos críticos | Reservas confirmadas con pre-evento, liquidación o fianza atrasada | Priorización |
| Pendientes | Pagos vencidos, presupuestos sin respuesta, TTLs a punto de expirar | Acciones inmediatas |
| Consultas en cola | Leads esperando liberación de fecha, agrupados por fecha solicitada, con tiempo en cola | Visibilidad de demanda saturada |
| **Visitas programadas** | Consultas en 2.v con fecha de visita próxima, ordenadas por fecha | Preparación de visitas |
| Próximos 30 días | Calendario con código de color por estado | Visión de carga |

### 7.2 Dashboard financiero e histórico

| Widget | Métrica | Periodo por defecto |
|---|---|---|
| Ingresos | Facturado vs cobrado | Mes actual vs mismo mes año anterior |
| Ocupación | % días reservados | Mes / trimestre / año |
| Ocupación interanual | Comparativa año actual vs anteriores | Histórico completo |
| Cobros pendientes | Total + lista detallada | Acumulado |
| Liquidaciones en riesgo | Reservas con T-7d sin cobro | Tiempo real |
| Tipología de eventos | Bodas, comuniones, corporativos, etc. | Año + comparativa anual |
| Ticket medio | € por evento | Mes / trimestre / año |
| Ratio conversión | Consulta → reserva confirmada | Mes |
| Tasa de reapertura | Consultas vinculadas a anteriores / total consultas | Trimestre |
| Tasa de demanda saturada| Leads que entraron en cola / total leads | Trimestre |
| Tasa de conversión desde cola | Leads en cola promocionados que llegaron a confirmada / total leads en cola | Trimestre |
| Leads por canal de entrada | Volumen y % de consultas por canal (Formulario web, Email directo, Instagram, WhatsApp, Llamada telefónica) | Mes / trimestre / año |
| Estacionalidad | Heatmap mensual de ingresos | 12–36 meses |
| Cancelaciones | Tasa y motivos | Año en curso |
| **Fianzas pendientes de devolución** | Reservas en post_evento con fianza cobrada y no devuelta, agrupadas por antigüedad | Tiempo real |

### 7.3 Histórico de reservas (vista de primera clase)

Sección crítica para D5.

- **Tabla maestra de reservas:** fecha, tipo de evento, estado final, importe facturado, nombre cliente, nº invitados.
- **Filtros:** rango de fecha, año, tipo de evento, estado, importe, sub-estado de consulta, **clientes recurrentes**, **consultas que pasaron por cola**.
- **Búsqueda full-text:** por nombre cliente, número de reserva, observaciones, email.
- **Vista de detalle de reserva archivada:** ficha completa accesible en modo lectura.
- **Vista de "vínculos del cliente":** desde cualquier consulta vinculada, ver todos los intentos anteriores del mismo cliente.
- **Exports:** CSV con filtros aplicados.

### 7.4 KPIs principales

| KPI | Fórmula | Por qué importa |
|---|---|---|
| **Tasa de ocupación** | días reservados / días disponibles | Salud del negocio |
| **Ocupación interanual** | ocupación año N vs año N-1 | Tendencias |
| **Ratio consulta → reserva** | reservas confirmadas / consultas | Calidad del funnel |
| **Conversión por sub-estado** | 2.a→2.b, 2.b→3, 3→4 | Detectar dónde se pierden leads |
| **Tasa de reapertura** | consultas con vínculo a intento anterior / total consultas | Indica si los TTLs son demasiado cortos |
| **Tasa de conversión de reaperturas** | reaperturas que llegan a reserva confirmada / total reaperturas | Mide ROI del esfuerzo en recurrentes |
| **Tasa de demanda saturada** | consultas que entraron en cola / total consultas | Detecta fechas/temporadas saturadas |
| **Tasa de conversión desde cola** | promociones desde cola que llegan a reserva confirmada / total promociones | Mide si vale la pena mantener la mecánica de cola |
| **Tasa de cola perdida** | consultas descartadas por cola (2.y) / total consultas en cola | Cuantifica leads perdidos por demanda saturada |
| **Tiempo medio consulta → pre-reserva** | media (días) | Velocidad operativa |
| **Tiempo medio pre-reserva → confirmación** | media (días) | Detecta clientes que dudan |
| **Ticket medio** | facturación / nº eventos | Upsell efectivo |
| **DSO liquidación** | días entre envío de factura y cobro | Salud financiera |
| **% liquidaciones en plazo** | liquidaciones cobradas antes de T-1d | Disciplina de cobro |
| **NPS post-evento** | media de encuestas | Calidad percibida |
| **Tasa de cancelación** | canceladas / (confirmadas + canceladas) | Estabilidad |
| **Distribución por tipología** | % de reservas por tipo de evento | Mix de negocio |
| **Conversión por canal de entrada** | reservas confirmadas / consultas, segmentado por canal | Detecta qué canales aportan leads de mayor calidad |
| **Tasa de conversión desde visita** | consultas que pasaron por 2.v y llegaron a reserva confirmada / total 2.v | Mide eficacia de las visitas |
| **Tiempo medio devolución de fianza** | días entre evento completado y fianza devuelta | Agilidad administrativa |
| **Fianzas pendientes** | número de fianzas cobradas aún no devueltas | Control de pasivos |

### 7.5 Exports

CSV con: reservas (con todos los atributos, vínculos a intentos anteriores y datos de cola), facturas, ingresos por periodo, eventos por tipología, histórico completo con filtros aplicables.

---

## 8. Diferenciadores

| Funcionalidad diferencial | Por qué un CRM genérico no lo hace bien |
|---|---|
| **Bloqueo atómico de fecha con TTL** | Los CRMs gestionan deals, no recursos físicos limitados |
| **Bloqueo condicional según madurez del lead** (3d en consulta con fecha, 7d en pre-reserva) | CRMs no entienden TTLs ni urgencia del calendario físico |
| **Cola automática de leads en fechas bloqueadas** con promoción y notificación automáticas | CRMs no entienden recursos físicos compartidos; gestores hacen seguimiento manual con Excel |
| **Sub-procesos paralelos pre-evento + liquidación** | CRMs son lineales; eventos reales no |
| **Detección automática de leads recurrentes con pre-relleno** | CRMs genéricos requieren búsqueda manual; pierden contexto |
| **Consultas como entidades inmutables vinculadas** | CRMs reabren deals (ensucia funnel); aquí preservamos cada intento como dato histórico |
| **Generador de presupuestos con motor de tarifas** | CRMs solo permiten plantillas estáticas |
| **Reserva como entidad central** (no cliente) | CRMs giran en torno a contactos/cuentas |
| **Histórico de reservas consultable, buscable y exportable** | CRMs guardan deals, no eventos ejecutados con contexto |
| **Ficha de evento operativa** (timing, contactos, menús, planos) | No existe en CRMs ni PMS |
| **Briefing automático al equipo el día -3** | Específico de operativa de eventos |
| **Pipeline con estados de evento, no de venta** | Semántica de evento, no de funnel comercial |
| **Política de cancelación y liquidación tardía configurables** | Lógica específica de hospitality |
| **Heatmap de ocupación** en calendario | No existe en CRMs |
| **Tarifario versionado** | CRMs no versionan precios |
| **Importación de reservas históricas** desde Sheets/Excel | CRMs no contemplan eventos pasados como dato cargable |
| **WhatsApp Business integrado** (V2) | El cliente típico de masía usa WhatsApp |

---

## 9. Roadmap

### 9.1 Alcance del MVP del TFM (entrega 29/07/2026)

El alcance del MVP del TFM se ha acotado deliberadamente para garantizar entrega funcional en plazo, dada la dedicación parcial y la curva de aprendizaje de SDD + TDD asistido por IA. Las funcionalidades se clasifican en dos categorías:

**✅ Implementado en MVP TFM** (funcional y desplegado)
**📐 Solo diseñado en la especificación** (forma parte del PRD pero no se construye)

### 9.2 Matriz de alcance del MVP TFM

| Funcionalidad | Estado MVP TFM |
|---|---|
| Auth básica + multi-tenant base (un solo tenant operativo) | ✅ Implementado |
| Pipeline completo de reservas: consulta (2.a, 2.b, 2.c, 2.d, **2.v**, 2.x, 2.y, 2.z) → pre_reserva → reserva_confirmada → pre_evento + liquidacion (paralelos) → evento_en_curso → post_evento → reserva_completada → reserva_cancelada | ✅ Implementado |
| Sub-procesos pre-evento + liquidación + fianza paralelos | ✅ Implementado |
| Cola de espera (sub-estados 2.d, 2.y, 2.z + promoción + reordenación + encadenamiento) | ✅ Implementado |
| **Sub-estado 2.v (visita programada)** con bloqueo hasta día post-visita (visita máx. 7d desde solicitud) + transiciones a 2.b/2.x/2.z | ✅ Implementado |
| Detección automática de leads recurrentes + tabla `consulta_vinculo` | 📐 Solo diseñado |
| Calendario visual con bloqueo atómico | ✅ Implementado |
| Ficha de reserva: datos cliente + datos evento | ✅ Implementado |
| Ficha operativa del evento (briefing, menús, timing) | ✅ Implementado (versión simple) |
| Histórico consultable con búsqueda y filtros básicos | ✅ Implementado |
| Importación CSV de reservas históricas | 📐 Solo diseñado (no se usa con Masia l'Encís) |
| Motor de tarifas (3 temporadas × 3 horas × 5 tramos invitados + 2 extras) | ✅ Implementado |
| Generación automática de presupuestos PDF | ✅ Implementado |
| Generación automática de facturas (señal, liquidación) | ✅ Implementado |
| **Factura de señal (40%) adjunta en email de confirmación** | ✅ Implementado |
| **Factura de liquidación (60% + extras) enviada al confirmar cobro** | ✅ Implementado |
| **Gestión de fianza:** cobro, recibo independiente, solicitud IBAN, devolución | ✅ Implementado |
| Factura complementaria post-evento (ajustes) | 📐 Solo diseñado |
| Emails automáticos del flujo principal (5 emails clave, ver lista abajo) | ✅ Implementado |
| Emails de cola (entrada en cola, promoción, descartado) | 📐 Solo diseñado |
| Recordatorios automáticos extendidos (T-15d, T-3d, T-1d, recordatorios de cobro, etc.) | 📐 Solo diseñado |
| Dashboard operativo (versión simple) | ✅ Implementado |
| Dashboard financiero + KPIs avanzados | 📐 Solo diseñado |
| Política de cancelación y liquidación tardía configurables | 📐 Solo diseñado (default "Negociable" hardcoded) |
| Audit log mínimo (tabla `audit_log` poblada automáticamente, sin UI) | ✅ Implementado |
| Parser de emails entrantes (LLM extrae info de consultas por email) | 📐 Solo diseñado |
| Integración Stripe para cobros | 📐 Solo diseñado |
| WhatsApp Business API | 📐 Solo diseñado |

> **Nota sobre la cola en MVP TFM:** la lógica de cola (entrada, promoción, vaciado, reordenación, encadenamiento) está completamente implementada como mecánica de backend y reflejada en la UI del calendario y la ficha de consulta. Los emails específicos de cola (entrada, promoción, descarte) se dejan para post-TFM; el cliente en cola será notificado manualmente por el gestor durante el MVP.

### 9.3 Emails automáticos en alcance MVP TFM

De los emails diseñados en la especificación, el MVP TFM implementa los **8 emails del flujo principal**. La columna "Comportamiento" indica si el email se envía automáticamente o requiere acción del gestor:

| # | Trigger | Email | Comportamiento |
|---|---|---|---|
| E1 | Lead entrante (1 → 2.a/2.b) | Respuesta inicial al cliente con tarifa estimada | **Condicional:** el gestor introduce el lead en el formulario normalizado de la herramienta (sea cual sea el canal de origen). Si los campos clave están completos y no hay comentarios → auto-envío. Si hay comentarios → el sistema genera un borrador que el gestor revisa, edita si es necesario, y confirma el envío (ver §4.2.1). |
| E2 | Gestor activa pre-reserva (transición a `pre_reserva`) | Email con presupuesto PDF adjunto e instrucciones de señal (40%) | **Automático** tras aprobación del presupuesto borrador por el gestor |
| E3 | Gestor sube justificante de señal (transición a `reserva_confirmada`) | **Confirmación de reserva al cliente con factura de señal adjunta** y próximos hitos | **Automático** tras aprobación de la factura de señal por el gestor |
| E4 | Inicio sub-proceso liquidación | Email con factura de liquidación (60% + extras) + recibo de fianza | **Automático** tras aprobación de la factura de liquidación por el gestor |
| E5 | Evento marcado completado (transición a `post_evento`) | Email de agradecimiento + NPS + **solicitud de IBAN para devolución de fianza** | **Automático** |
| E6 | Gestor acepta solicitud de visita (transición a 2.v) | Confirmación de visita programada con fecha/hora | **Automático** |
| E7 | Visita realizada, cliente confirma interés (transición 2.v → 2.b) | Confirmación de bloqueo post-visita (3 días) | **Automático** |
| E8 | Cliente proporciona IBAN en post_evento | Confirmación de recepción de IBAN + próximos pasos para devolución | **Automático** |

> **Nota sobre "Automático":** en todos los casos el gestor puede pausar el envío para una reserva concreta o reenviar manualmente desde el log de comunicaciones (ver §6.3). "Automático" indica que el sistema lo ejecuta sin que el gestor tenga que iniciarlo explícitamente, una vez que se cumple el trigger.

Los emails restantes (recordatorios pre-evento, cola, recurrentes, briefing al equipo, recordatorios de cobro, etc.) están **diseñados en la especificación pero no implementados en MVP TFM**.

### 9.4 Planificación temporal del TFM

| Hito | Fecha | Entregable |
|---|---|---|
| **H1 — Documentación técnica** | 12/06/2026 (~4 semanas) | PRD completo (este documento), ERD detallado, historias de usuario formales, wireframes principales, setup inicial de SDD + repo + entorno de IA |
| **H2 — Código funcional** | 10/07/2026 (~4 semanas más) | Backend + frontend + BBDD conectados. Flujo principal completo end-to-end: lead → consulta (con cola) → pre_reserva → confirmada → pre_evento + liquidación (paralelos) → evento → post_evento → completada. Auth + tarifas + presupuestos PDF + 5 emails + audit log |
| **H3 — Entrega final** | 29/07/2026 (~2.5 semanas más) | Versión completa desplegada. Tests pasando (incluyendo concurrencia en cola). Memoria cerrada. Bitácora documentada. Defensa preparada |

### 9.5 Roadmap post-TFM (planificación a largo plazo, fuera del TFM)

| Fase | Funcionalidades clave | Objetivo |
|---|---|---|
| **V1 post-TFM** | Detección de recurrentes, recordatorios extendidos, emails de cola, factura complementaria, importador CSV, dashboard financiero completo | Producto comercializable con Masia l'Encís en producción real |
| **V2** | M8 (tareas), parser de emails, Stripe, plantillas configurables, política de liquidación tardía configurable, sub-perfiles operativos | Primera apertura a otros tenants |
| **V3** | M9 (proveedores), WhatsApp Business API, onboarding self-service, portal cliente, integración contable, multi-idioma, **multi-espacio por tenant** | Plataforma comercializable a otras masías, incluidas las que tengan varios espacios reservables por separado |
| **V4 / Premium** | Asistente IA, recomendador de tarifas dinámicas, portal marketplace, app móvil operativa, integración con cateres | Diferenciación e ingresos premium |

---

## 10. Stack

### 10.1 Stack propuesto

| Capa | Tecnología | Razón |
|---|---|---|
| Frontend | **Next.js 14+ (App Router) + React + TypeScript** | Productividad, SSR, ecosistema maduro |
| UI | **Tailwind + shadcn/ui** | Velocidad de desarrollo |
| Calendario | **FullCalendar** o **react-big-calendar** | Maduros, fiables para vistas mensuales y semanales |
| Backend | **Node.js + tRPC o NestJS** | Type-safety end-to-end / estructura empresarial |
| BBDD | **PostgreSQL** | Multi-tenant con RLS nativo |
| ORM | **Prisma** o **Drizzle** | Type-safe, migraciones controladas |
| Búsqueda histórica | **Postgres FTS** (MVP) → **Meilisearch** (V2) | Búsqueda en histórico |
| Auth | **Clerk** o **Auth.js** | Outsourcing de auth |
| Storage | **Cloudflare R2** o **S3** | PDFs, imágenes, justificantes de pago |
| PDFs | **react-pdf** o **Puppeteer + plantillas HTML** | Generación server-side fiable |
| Email | **Resend** o **Postmark** | Deliverability alta |
| Pagos | **Stripe** (V1+) | Estándar SaaS |
| Hosting | **Vercel** + DB en **Neon** o **Supabase** | Despliegue rápido, autoescalado |
| Background jobs | **Inngest** o **Trigger.dev** | Recordatorios, jobs programados, promociones de cola |
| Observabilidad | **Sentry** + **PostHog** | Errores + analytics |

### 10.2 Decisiones arquitectónicas clave (no negociables)

1. **Multi-tenancy desde el día 1.** `tenant_id` en cada tabla + RLS en Postgres.
2. **Un tenant = un espacio.** El espacio es implícito en el tenant; no es entidad independiente. Atributos del espacio (nombre comercial, capacidad máxima, descripción) viven en `tenant_settings`.
3. **Reserva como agregado raíz** (DDD).
4. **Máquina de estados como configuración, no como código.** `workflow_definition` por tenant.
5. **TTLs, porcentajes de pago, plazos y fianza en `tenant_settings`.** Incluye `fianza_default_eur` (importe por defecto de fianza) y `max_dias_programar_visita` (máximo días desde solicitud para programar visita, default 7).
6. **Plantillas de email y PDF como entidades por tenant.**
7. **Tipos de evento y extras como datos del tenant.**
8. **Audit log de todas las acciones sobre reservas y facturas.**
9. **Idempotencia en webhooks y endpoints de creación de reserva.**
10. **Eventos de dominio** (`ReservationCreated`, `ConsultationExpired`, `RecurringLeadDetected`, `QueueEntered`, `QueuePromoted`, `QueueDiscarded`, `ReservationConfirmed`, `DepositReceived`, `PreEventClosed`, `LiquidationCollected`, **`DepositCollected`**, `EventStarted`, `EventCompleted`, `ReservationArchived`, **`VisitScheduled`**, **`VisitCompleted`**, **`DepositRefundRequested`**, **`DepositRefunded`**) como base para automatizaciones.
11. **Transacciones para bloqueos de fecha y promociones de cola.** `SELECT ... FOR UPDATE`. Imprescindible para evitar race conditions en operaciones concurrentes.
12. **Sub-procesos paralelos como campos independientes** (`pre_evento_status`, `liquidacion_status`, `fianza_status`) con guardas en transición a `evento_en_curso`.
13. **Indexación del histórico:** índices compuestos en `(tenant_id, fecha_evento, estado)` y full-text.
14. **Consultas son entidades inmutables.** Los estados terminales no se reabren. Las reaperturas crean entidad nueva vinculada via `consulta_vinculo`.
15. **Índice por `(tenant_id, email_normalized)`** en la tabla de clientes para detección eficiente de recurrentes. Latencia objetivo <100ms.
16. **Cola modelada como campos en la entidad reserva** (`posicion_cola`, `consulta_bloqueante_id`), no como tabla auxiliar. Simplifica queries y mantiene cohesión.
17. **Índice por `(tenant_id, consulta_bloqueante_id, posicion_cola)`** para promociones y reordenaciones eficientes de la cola.

### 10.3 Decisión arquitectónica: estrategia de adaptabilidad multi-tenant

**Decisión:** Slotify se construye como un producto **opinado por fuera y configurable por dentro**.

**Qué significa:**
- **Por fuera (UX):** un único flujo operativo visible para el usuario, basado en el modelo de Masia l'Encís (señal 40% + liquidación 60% pre-evento, pre-evento y liquidación en paralelo, archivo en histórico tras el evento, cola automática para fechas bloqueadas).
- **Por dentro (arquitectura):** la máquina de estados, TTLs, porcentajes, plantillas, tipos de evento y políticas se modelan como **configuración por tenant** desde el día 1.

**Plan por fases:**
- **MVP / V1:** un único perfil operativo (Masia l'Encís). Configurabilidad limitada.
- **V2:** introducción de 2–3 **sub-perfiles operativos** preconfigurados.
- **V3+:** evaluar motor de workflows configurables solo si el volumen lo justifica. Apertura a tenants con múltiples espacios reservables por separado.

**Por qué esta decisión:**
- Producto opinado = onboarding rápido, UX limpia, vendible al ICP.
- Arquitectura configurable internamente = sin coste prohibitivo de evolución.
- Evita el anti-patrón "plataforma que intenta hacer todo y no hace nada bien".

**Riesgo aceptado:** clientes con operativa radicalmente distinta no serán objetivo en MVP/V1. Tenants con múltiples espacios reservables por separado quedan fuera de alcance hasta V3+.

---

## 11. UX/UI

### 11.1 Principios de diseño

| Principio | Por qué |
|---|---|
| **Calendario como home** | El gestor mira el calendario 20 veces al día |
| **Reserva como objeto navegable principal** | URL canónica `/reservas/:id` |
| **Histórico accesible desde primer nivel** | "Reservas → Activas / Histórico" |
| **Cola visible en el calendario** | Indicador visual en fechas con cola: "🔁 3 en cola" |
| **Sub-procesos paralelos visibles en la ficha** | Dos barras de progreso lado a lado |
| **Cliente recurrente, banner destacado en ficha** | Contexto inmediato sin clic adicional |
| **Cliente en cola, banner con posición y estado** | Visibilidad de la situación de espera |
| **Densidad informativa controlada** | Tooltips y previews al hover |
| **Acciones de un clic** | Crear consulta, enviar presupuesto, marcar señal pagada |
| **Estados con código de color consistente** | Gris=consulta, ámbar=pre-reserva, verde=confirmada, azul=histórica, rojo=cancelada, violeta=en cola |
| **Diseño web-responsive** | gestión a través de Desktop o mobile |
| **Plantillas de email editables antes de enviar** | Review humano siempre |
| **Vistas guardadas** | Cada gestor personaliza filtros |
| **Búsqueda global con cmd+K** | Prioriza reservas (fecha, código, nombre) |

### 11.2 Patrones UI específicos

- **Vista calendario:** mes / semana / día / lista. Bloques con color de estado. Fechas con cola muestran un indicador "🔁 N en cola".
- **Vista de fecha con cola:** al hacer clic en una fecha con cola, se ve la consulta bloqueante (2.b) y la lista ordenada de consultas en cola.
- **Vista de reserva (ficha):** 3 columnas — datos cliente + datos evento | timeline + doble barra pre-evento/liquidación | acciones rápidas + comunicaciones.

- **Banner "Cliente recurrente"** en ficha de consulta, cuando aplique:
```
  ┌─────────────────────────────────────────────────────────────┐
  │ ⚠ Cliente recurrente — 2 intentos previos                   │
  ├─────────────────────────────────────────────────────────────┤
  │ • 01/03/2026 — Consulta expirada (sub-estado 2.b)           │
  │   Fecha solicitada: 15/06/2026 · 80 invitados · Boda        │
  │   Motivo: TTL agotado sin respuesta                         │
  │                                                             │
  │ [Ver detalle del intento anterior]  [Desvincular]           │
  └─────────────────────────────────────────────────────────────┘
```

- **Banner "Consulta en cola"** en ficha de consulta 2.d:
```
  ┌─────────────────────────────────────────────────────────────┐
  │ ⏳ Consulta en cola — Posición 2 de 3                        │
  ├─────────────────────────────────────────────────────────────┤
  │ Fecha solicitada: 15/06/2026                                │
  │ Bloqueada por: Consulta #R001 (Anna García)                 │
  │ TTL bloqueante expira: 04/03/2026 (en 2 días)               │
  │                                                             │
  │ [Ver consulta bloqueante]  [Forzar salida de cola]          │
  └─────────────────────────────────────────────────────────────┘
```

- **Vista de fecha con cola (al clicar en calendario):**
```
  ┌─────────────────────────────────────────────────────────────┐
  │ 15/06/2026                                                  │
  ├─────────────────────────────────────────────────────────────┤
  │ Estado: Bloqueada (consulta 2.b)                            │
  │                                                             │
  │ ● Bloqueante: R001 — Anna García (boda, 80 inv.)            │
  │   TTL expira: 04/03/2026                                    │
  │                                                             │
  │ Cola (2 en espera):                                         │
  │ #1 R002 — Berto López (cumple, 50 inv.) — desde 02/03       │
  │ #2 R003 — Cristina Pérez (boda, 100 inv.) — desde 03/03     │
  │                                                             │
  │ [Ver reserva bloqueante]  [Gestionar cola]                  │
  └─────────────────────────────────────────────────────────────┘
```

- **Campos pre-rellenados desde intentos anteriores** marcados con un icono y tooltip: "Heredado de consulta del 01/03/2026. Confirma o edita."
- **Vista de histórico:** tabla con filtros laterales, búsqueda destacada, export CSV.
- **Editor de presupuestos:** preview en vivo del PDF a la derecha.
- **Confirmaciones explícitas** en acciones destructivas.
- **Indicadores de sub-estado de consulta:** badges visuales (`Exploratoria`, `Con fecha`, `Pendiente invitados`, `En cola #N`, `Expirada`, `Descartada por cola`, `Descartada por cliente`, `Recurrente`).

### 11.3 Tono y lenguaje

- Castellano/catalán configurable por tenant.
- Lenguaje cercano pero profesional: "reserva", "evento", "cliente".
- Mensajes de error en lenguaje natural.
- **Especial cuidado en plantillas de cola:** lenguaje no comprometedor. "No supone compromiso por nuestra parte", "te recomendamos explorar otras fechas en paralelo".

---

## 12. Ventajas competitivas

### 12.1 Análisis del mercado actual

| Tipo de competidor | Ejemplos | Por qué no encaja |
|---|---|---|
| CRMs generalistas | HubSpot, Pipedrive | Cliente-céntricos; no entienden recursos físicos ni eventos |
| Software de bodas (US) | Honeybook, Aisle Planner | Centrado en wedding planners, no en propietarios |
| PMS hoteleros | Cloudbeds, Mews | Optimizado para habitaciones por noche, no eventos |
| Software de salas grandes | Tripleseat, Event Temple | Para venues 500+ eventos/año; caro y complejo |
| Soluciones locales (España) | Excel + email | El statu quo a batir |

### 12.2 Ventajas defendibles

1. **Vertical depth:** entender un negocio familiar de 50–150 eventos/año.
2. **Modelo reserva-céntrico:** alineado con la realidad de eventos privados.
3. **Sub-procesos paralelos:** refleja cómo realmente trabaja una masía.
4. **Gestión nativa de leads recurrentes:** preserva contexto histórico sin distorsionar funnel.
5. **Cola automática de leads en fechas saturadas:** maximiza conversión en temporada alta sin intervención manual.
6. **Time-to-value bajo:** onboarding <1 semana.
7. **Sustitución directa de Gmail+Sheets+Drive+WhatsApp.**
8. **Precio acorde:** 50–150 €/mes.
9. **Idioma y normativa local.**

### 12.3 Riesgos competitivos

- Honeybook u otro internacional puede entrar en EU con localización fuerte. Ventaja: el conocimiento del nicho "masía familiar" es difícil de replicar.
- Competidor local sobre Notion/Airtable. Ventaja: producto verticalizado.

---

## 13. Decisiones cerradas en esta especificación

1. **Reserva como entidad central** (no cliente).
2. **Bloqueo de fecha condicional en consulta** (3 días si fecha concreta, +3 si falta invitados).
3. **Liquidación pre-evento** (no post-evento). 40% señal + 60% liquidación.
4. **Pre-evento y liquidación como sub-procesos paralelos** (no secuenciales).
5. **Estrategia multi-tenant: opinado por fuera, configurable por dentro.**
6. **Justificantes de pago por subida manual del gestor** en MVP (Stripe en V1).
7. **Gestión de leads recurrentes: Opción B (nueva consulta vinculada).** Consultas inmutables; reaperturas crean entidad nueva con vínculo.
8. **Detección automática de recurrentes por email** con posibilidad de desvincular manualmente.
9. **Cliente recurrente sin prioridad sobre la fecha** si ya está bloqueada por otro lead activo.
10. **Cola automática activada SOLO si la consulta bloqueante está en 2.b.** Tiempo máximo en cola: 3 días.
11. **Cola FIFO ilimitada** con campo `posicion_cola` en la entidad reserva.
12. **Promoción automática del primero en cola** cuando la bloqueante expira.
13. **Vaciado automático de cola** cuando la bloqueante avanza a 2.c o pre_reserva.
14. **Encadenamiento automático de promociones** si el promovido tampoco responde.
15. **Cliente puede salir de la cola voluntariamente** vía CTA en email.
16. **Entrada automática en cola (sin opt-in)** con opción a salir voluntariamente.
17. **Sin prioridad por recurrencia en cola:** primer llegado primer servido.
18. **Cola solo por fecha exacta solicitada** (no fechas próximas).
19. **Estados terminales nuevos:** `2.x consulta_expirada`, `2.y consulta_descartada_por_cola`, `2.z consulta_descartada_por_cliente`.
20. **Modelo 1 tenant = 1 espacio.** Tenants con múltiples espacios reservables por separado quedan fuera de alcance hasta V3+. Si un cliente comercial tiene varios espacios, se crearán varios tenants (uno por espacio).

## 14 Riesgos técnicos

- **Doble reserva:** tests exhaustivos de concurrencia. Imprescindible.
- **Race conditions en cola:** promociones y reordenaciones deben ser transaccionales. Tests específicos para escenarios concurrentes (cliente sale de cola justo cuando se promueve, etc.).
- **Deliverability de emails:** SPF/DKIM/DMARC desde el día 1. Especialmente crítico en emails de cola, donde la fiabilidad del aviso es comercialmente sensible.
- **RGPD:** anonimización del histórico (no borrado físico) para preservar trazabilidad financiera.
- **Backups:** PITR de Postgres obligatorio.
- **Migración del histórico actual:** importador desde CSV/Excel desde el día 1.
- **Sub-procesos paralelos:** UI bien diseñada; mal explicados pueden confundir al gestor.
- **Falsos positivos en detección de recurrencia:** emails compartidos en familia pueden generar vínculos erróneos.
- **Riesgo comercial de la cola:** mal redactados, los emails de cola pueden parecer compromisos verbales. Plantillas con lenguaje no vinculante son críticas.

---

## 15. Metodología de desarrollo (SDD + TDD asistido por IA) y bitácora

Esta sección documenta la metodología utilizada para construir el MVP del TFM. **No forma parte del PRD funcional del producto**; está aquí porque es contexto relevante para entender las decisiones de alcance (§9) y las estimaciones temporales.

### 15.1 Enfoque metodológico

El MVP de Slotify se construye utilizando tres pilares metodológicos combinados:

1. **SDD (Spec-Driven Development) con open-spec**: la especificación funcional (este documento) es la fuente de verdad. Las tareas de desarrollo se derivan de specs estructuradas con criterios de aceptación machine-readable.
2. **TDD (Test-Driven Development)**: para cada funcionalidad, primero se escriben los tests que definen el comportamiento esperado; después se implementa el código hasta hacerlos pasar.
3. **Desarrollo asistido por IA en todas las fases del SDLC**: la IA participa en análisis de requisitos (esta fase), diseño, generación de código, generación de tests, refactoring y documentación. El humano valida, decide arquitectura y supervisa.

### 15.2 Reparto de responsabilidades humano / IA

| Fase del SDLC | Responsabilidad principal del humano | Apoyo de la IA |
|---|---|---|
| Análisis de requisitos | Decisión sobre alcance, casos de uso, prioridades | Estructuración, detección de inconsistencias, propuestas alternativas |
| Diseño funcional y arquitectura | Decisiones estratégicas, validación de coherencia | Propuestas, análisis comparativo, identificación de edge cases |
| Generación de código | Validación, revisión, decisiones de patrón | Generación de boilerplate, implementación guiada por specs y tests |
| Tests (TDD) | Definición del comportamiento esperado | Generación de casos de prueba, casos límite, mocks |
| Refactoring | Decisión sobre cuándo y qué refactorizar | Ejecución del refactor, propuesta de mejoras |
| Documentación | Estructura general, validación | Redacción, ejemplos, diagramas |
| Code review | Revisión humana obligatoria de todo output | Análisis previo, detección de problemas comunes |

**Principio rector:** la IA propone, el humano decide. Ningún código entra al repositorio sin revisión humana, especialmente en zonas críticas (bloqueo atómico de fecha, máquina de estados, motor de tarifas, cola con concurrencia).

---

## Resumen ejecutivo (TL;DR)

- **La reserva es la entidad central.** El cliente es un atributo.
- **Un tenant = un espacio.** Multi-espacio queda fuera de alcance hasta V3+.
- **Bloqueo de fecha condicional** según madurez del lead: 3 días en consulta con fecha, +3 si falta info, 7 días en pre-reserva, firme en confirmada.
- **Cola automática FIFO** para leads que solicitan fechas bloqueadas por otra consulta en 2.b. Promoción y vaciado automáticos según evolución de la bloqueante.
- **Pre-evento y liquidación corren en paralelo.** El día del evento requiere ambos cerrados.
- **Liquidación pre-evento con deadline T-1d.** 40% señal + 60% liquidación.
- **Leads recurrentes:** consultas son entidades inmutables. Cuando un cliente vuelve tras una consulta terminal, se crea una nueva consulta vinculada con pre-relleno automático de información (📐 solo diseñado, no implementado en MVP TFM).
- **Estrategia "opinado por fuera, configurable por dentro":** MVP con un solo flujo, arquitectura preparada para sub-perfiles en V2.
- **Riesgo crítico #1:** doble reserva y race conditions en cola. Tests de concurrencia desde la primera semana.
- **Riesgo crítico #2:** scope creep. El MVP que has definido es realmente un V1.
- **Riesgo crítico #3:** importador del histórico. Sin él, el cliente no migra.
- **Riesgo crítico #4:** UX de sub-procesos paralelos, vínculos de recurrencia y cola bien explicada visualmente o el gestor se pierde.
- **Riesgo crítico #5:** redacción de emails de cola. Lenguaje no comprometedor para evitar interpretaciones de reserva verbal.
- **Contexto TFM:** alcance MVP incluye proceso completo end-to-end + sub-procesos paralelos + cola (§9), desarrollo con SDD + TDD asistido por IA y bitácora paralela (§14). Detección de recurrentes, importador CSV y dashboard financiero avanzado están **diseñados pero no implementados** en el MVP TFM.
