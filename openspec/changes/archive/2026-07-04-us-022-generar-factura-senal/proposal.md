# Change: us-022-generar-factura-senal

## Why

US-022 documenta financieramente la señal (Crítica, UC-18): **cuando la RESERVA transita
a `reserva_confirmada` (US-021)**, el sistema genera automáticamente la **factura de señal
como borrador** con el desglose del 40 % del importe total del presupuesto aceptado, con
datos fiscales correctos, lista para la revisión y aprobación del Gestor antes del envío
en E3. Resuelve **D6** (el cálculo automático de base imponible + IVA 21 % elimina errores
aritméticos de la facturación manual) y **D1** (la generación automática elimina el paso
manual de crear la factura). (Fuente: `US-022 §Historia`, `§Contexto de Negocio`,
`§Impacto de Negocio`; UC-18; `er-diagram.md §3.12 FACTURA`, `§TENANT_SETTINGS pct_senal`,
`§CLIENTE`, `§TENANT`.)

El cimiento ya existe en `master` y **se reutiliza, no se recrea**:

- **Trigger `reserva_confirmada` (US-021, capability `confirmacion`)**: la spec viva de
  `confirmacion` ya declara el requisito "Presentación de la factura de señal en borrador
  tras confirmar (disparo US-022)". Este change **implementa** ese disparo: genera la
  FACTURA `tipo = 'senal'` en `borrador` como efecto **posterior al commit** de la
  confirmación; su fallo NO revierte la confirmación ya realizada (US-021).
- **Importes congelados (US-021)**: la confirmación ya fijó `RESERVA.importe_senal =
  round(importe_total × pct_senal / 100, 2)` (40 % MVP). Este change **consume** ese valor
  como `FACTURA.total` de la señal; no recalcula el porcentaje ni la tarifa.
- **Mecanismo de generación de PDF (US-014/US-021)**: el patrón puerto/adaptador de PDF ya
  existe (`presupuestos` define `GenerarPdfPresupuestoPort` con adaptador fake determinista
  post-commit e idempotente sobre `pdf_url`). Este change **reutiliza ese mismo mecanismo**
  (puerto de dominio + adaptador de infraestructura, generación post-commit, `pdf_url`
  nullable hasta generar) para la factura de señal. **Decisión del usuario aprobada.**
- **DOCUMENTO polimórfico + `TipoDocumento.factura` (US-021+)**: el enum ya contempla
  `factura`; el PDF de la factura se referencia por `FACTURA.pdf_url` (patrón de
  `PRESUPUESTO.pdf_url`).
- **AUDIT_LOG (US-003+)**: `accion = 'crear'` al crear la FACTURA y `accion = 'actualizar'`
  al aprobar (borrador → enviada) / rechazar, en la misma transacción de cada mutación.
- **TENANT_SETTINGS.pct_senal, TENANT (nif/iban/direccion/nombre), CLIENTE (datos
  fiscales)**: ya en el modelo; se **leen** para el importe y el desglose fiscal del PDF.

(Fuente: ver `design.md` para firmas previstas, rutas reales y decisiones de reuso.)

## What Changes

> Slice vertical (backend + contrato + frontend "revisar/aprobar/rechazar factura de señal
> en borrador"). Sujeto al **Gate de revisión humana SDD** (decisiones en `design.md`).

- **Generación automática de la FACTURA de señal (post-commit de la confirmación de
  US-021)**: al detectar la transición a `reserva_confirmada`, el sistema crea **una** fila
  FACTURA con:
  - `tipo = 'senal'`, `estado = 'borrador'`, `reserva_id`, `tenant_id`.
  - `total = RESERVA.importe_senal` (= `round(importe_total × pct_senal / 100, 2)`, 40 % MVP,
    congelado en US-021).
  - Desglose fiscal derivado del total: `base_imponible = round(total / 1,21, 2)`,
    `iva_importe = total − base_imponible`, `iva_porcentaje = 21,00` (redondeo contable a 2
    decimales, mitad hacia arriba).
  - `concepto` con el texto de la señal (p. ej. "Señal 40 % — reserva {codigo}").
  - `numero_factura` con formato `F-YYYY-NNNN`, **secuencial y único por `tenant_id` + año
    calendario** (constraint `UNIQUE(tenant_id, año(numero_factura))` a nivel de negocio;
    ver `design.md §D-3`). (Fuente: `US-022 §Reglas de negocio`, `§Reglas de Validación`.)
- **Idempotencia (una factura de señal por reserva)**: antes de crear, el sistema comprueba
  si ya existe una FACTURA con `reserva_id = X AND tipo = 'senal'`. Si existe, **no duplica**
  y **devuelve la existente**; `AUDIT_LOG` registra el intento de duplicado. Garantizado a
  nivel de BD por un constraint `UNIQUE(reserva_id, tipo)` (defensa en profundidad ante
  reinvocaciones concurrentes del trigger). (Fuente: `US-022 §Factura de señal ya
  existente (idempotencia)`.)
- **Generación del PDF (reutilizando el mecanismo existente) + `pdf_url`**: tras crear la
  FACTURA en `borrador`, el sistema genera el PDF con los datos fiscales del **emisor**
  (`TENANT.nombre`, `TENANT.nif`, `TENANT.iban`, `TENANT.direccion`) y del **receptor**
  (`CLIENTE.nombre`, `CLIENTE.apellidos`, `CLIENTE.dni_nif`, `CLIENTE.direccion`,
  `CLIENTE.codigo_postal`, `CLIENTE.poblacion`, `CLIENTE.provincia`), el concepto, el
  desglose y el total; almacena `FACTURA.pdf_url`. `AUDIT_LOG` con `accion = 'crear'`.
- **Datos fiscales del cliente incompletos → borrador inválido, sin PDF, E3 bloqueado**: si
  al generar el PDF `CLIENTE.dni_nif` o cualquier campo de dirección fiscal es nulo, el
  sistema crea la FACTURA en `borrador` pero la marca **inválida** ("Datos fiscales
  incompletos"), **no genera el PDF** (`pdf_url = null`), notifica al Gestor y **bloquea la
  aprobación** (y por tanto E3) hasta que los datos se completen. (Fuente: `US-022 §Datos
  fiscales del cliente incompletos`.)
- **Error de generación del PDF → borrador con `pdf_url = null`, reintento, aprobación
  bloqueada**: si el servicio de PDF falla temporalmente, la FACTURA queda en `borrador`
  con `pdf_url = null`, se registra la incidencia ("PDF pendiente de regenerar"), el sistema
  **reintenta la generación de forma automática** y la aprobación queda bloqueada hasta que
  el PDF esté disponible. (Fuente: `US-022 §Error de generación del PDF`; patrón post-commit
  idempotente de US-014.)
- **Revisión del Gestor — aprobar el borrador**: el Gestor visualiza el borrador en la ficha
  de la reserva y pulsa "Aprobar factura". Precondición: PDF disponible y datos fiscales
  válidos. Efecto: `FACTURA.estado → 'enviada'`, `FACTURA.fecha_emision = now()`; la factura
  queda **lista para adjuntarse en E3**; `AUDIT_LOG` con `accion = 'actualizar'`,
  `datos_anteriores.estado = 'borrador'`, `datos_nuevos.estado = 'enviada'`. El Gestor **no
  puede modificar** importes ni datos fiscales del borrador (provienen de RESERVA y CLIENTE).
  (Fuente: `US-022 §Happy Path` (aprobación), `§Reglas de negocio`.)
- **Revisión del Gestor — rechazar el borrador**: si el Gestor detecta una incidencia (p. ej.
  datos del tenant incorrectos) y pulsa "Rechazar borrador" indicando el motivo, la FACTURA
  **permanece en `borrador`**, el motivo se registra en `AUDIT_LOG` y **E3 queda bloqueado**;
  el Gestor puede resolver la incidencia (p. ej. corregir datos del tenant en configuración)
  y **regenerar el PDF** para volver a revisar. (Fuente: `US-022 §Gestor rechaza el borrador`.)
- **Concurrencia (zona crítica: número de factura secuencial)**: dos reservas **distintas**
  del mismo tenant confirmadas de forma concurrente intentan asignar el siguiente
  `F-YYYY-NNNN`. La colisión la resuelve el constraint `UNIQUE` del número de factura: una
  de las dos inserciones falla (`P2002`) y la aplicación **reintenta con el siguiente número
  disponible**; ninguna factura queda sin número ni con número repetido. Cubierto con
  **tests de concurrencia reales** en TDD-RED (skill `concurrency-locking`). (Fuente:
  `US-022 §Concurrencia / Race Conditions`.)
- **Frontend "Factura de señal (borrador)"**: en la ficha de una RESERVA en
  `reserva_confirmada`, el Gestor ve la factura de señal en borrador (número, desglose,
  total, enlace al PDF cuando exista) con acciones **Aprobar** (deshabilitada si el borrador
  es inválido o el PDF no está disponible) y **Rechazar** (con motivo). Muestra el aviso de
  "Datos fiscales incompletos" / "PDF pendiente de regenerar" cuando aplique. Responsive
  mobile-first (390/768/1280).

## Impact

- Specs: **crea una nueva capability `facturacion`** con los requisitos propios de la
  **generación de la factura de señal** (creación como borrador con `tipo = 'senal'`, cálculo
  del desglose fiscal 21 % con redondeo contable, numeración `F-YYYY-NNNN` secuencial por
  tenant+año, idempotencia por `(reserva_id, tipo)`, generación de PDF con datos del emisor
  y receptor reutilizando el mecanismo existente, borrador inválido por datos fiscales
  incompletos, error/reintento de PDF, aprobación/rechazo por el Gestor y auditoría) y la
  **concurrencia de la numeración**. **Modifica la capability `confirmacion`** (concreta el
  requisito ya presente "disparo US-022": tras el commit de la confirmación, el sistema
  **genera** la factura de señal en borrador y bloquea E3 hasta su aprobación).
  - **Justificación de la nueva capability `facturacion`** (ver `design.md §D-1`): la FACTURA
    es un **agregado propio** con su ciclo de vida (`borrador → enviada → cobrada`), su
    numeración fiscal y sus reglas contables, que crecerá con UC-21 (factura de
    liquidación 60 %), fianza y complementarias. Mantenerla separada de `confirmacion`
    (justificante + FICHA_OPERATIVA + sub-procesos) y de `consultas` (ciclo de vida del
    lead) preserva la cohesión, igual que US-014 separó `presupuestos`. El módulo backend ya
    existe como esqueleto vacío en `apps/api/src/facturacion/` (creado en el scaffolding);
    este change lo puebla.
- Contrato OpenAPI (`docs/api-spec.yml`): se prevén endpoints nuevos (ver `design.md §D-6`,
  input para la fase de contrato): `GET /reservas/{id}/factura-senal` (obtener el borrador),
  `POST /facturas/{id}/aprobar` (borrador → enviada), `POST /facturas/{id}/rechazar`
  (motivo; permanece en borrador) y `POST /facturas/{id}/regenerar-pdf` (reintento manual).
  La **creación** de la factura no es un endpoint público: es un efecto post-commit del
  disparo de US-021 (o un job de reintento del PDF). El `contract-engineer` (post-gate) los
  definirá; **no se toca `docs/api-spec.yml` en este change de spec**. No se edita el cliente
  generado a mano.
- Código (implementación posterior, fuera de este change de spec):
  `apps/api/src/facturacion/{domain,application,infrastructure,interface}/**` (use-case de
  generación de la factura de señal, servicio de numeración `F-YYYY-NNNN` con reintento ante
  `P2002`, cálculo del desglose fiscal en dominio puro, puerto de generación de PDF +
  adaptador reutilizando el mecanismo de US-014, use-cases de aprobar/rechazar/regenerar,
  AUDIT_LOG), integración con el post-commit de `confirmacion`
  (`apps/api/src/confirmacion/**`), y `apps/web/src/features/facturacion/**` (visualización
  del borrador + acciones aprobar/rechazar). La ubicación exacta se fija en `design.md §D-1`.
- **Migración**: **prevista** (ver `design.md §D-7`). La tabla FACTURA ya existe con todas
  las columnas necesarias (`numero_factura`, `tipo`, `base_imponible`, `iva_porcentaje`,
  `iva_importe`, `total`, `concepto`, `pdf_url`, `estado`, `fecha_emision`) en
  `er-diagram.md §3.12` y `schema.prisma`. **Pero** el `numero_factura` actual es
  `@unique` **global** y falta el constraint de idempotencia: la migración aditiva debe
  (a) cambiar la unicidad de `numero_factura` a **`UNIQUE(tenant_id, numero_factura)`** (el
  año va embebido en el número; ver `design.md §D-3`) y (b) añadir
  **`UNIQUE(reserva_id, tipo)`** para la idempotencia de la factura por reserva y tipo. Es la
  única migración estructural prevista.
- Trazabilidad: **US-022**, **UC-18** (principal); UC-17 (trigger, cubierto en US-021);
  entidades FACTURA, RESERVA, CLIENTE, TENANT, TENANT_SETTINGS, AUDIT_LOG.
- Dependencias (todas en `master`): **US-021** (transición a `reserva_confirmada` +
  `importe_senal` congelado = trigger), **US-014** (fija `RESERVA.importe_total` desde el
  presupuesto aceptado y aporta el patrón de PDF reutilizado), US-003+ (AUDIT_LOG).

## Lo que NO entra (anti-scope)

- **Envío del email E3**: E3 adjunta el PDF de la factura de señal aprobada junto con las
  condiciones particulares (US-023). Este change deja la factura **lista** para adjuntarse en
  E3 tras la aprobación, pero **NO envía E3** (motor de email US-045 + US-023, fuera de
  alcance). (Fuente: `US-022 §Email relacionado`.)
- **Condiciones particulares (US-023 / UC-19)**: la generación del documento de condiciones
  particulares es US-023, fuera de este change. E3 solo se dispara cuando ambas (factura
  aprobada + condiciones) están listas.
- **Factura de liquidación 60 % (UC-21) / fianza / complementarias**: este change solo crea
  la factura `tipo = 'senal'`. Los otros tipos son US posteriores; la capability
  `facturacion` está diseñada para acogerlos sin redefinirse.
- **Conciliación de PAGO contra la factura**: el registro del cobro (`PAGO`) y el paso
  `enviada → cobrada` son de US posteriores (UC-21/US-029); aquí la factura llega hasta
  `enviada`.
- **Motor de tarifa / recálculo de importes**: el `total` de la señal se toma de
  `RESERVA.importe_senal` (congelado en US-021 desde `importe_total` de US-014). Este change
  **no recalcula** tarifa ni porcentaje.
- **Adaptador real de PDF (Puppeteer/react-pdf)**: como en US-014, el MVP entrega el
  mecanismo de puerto/adaptador con un adaptador determinista; el render real es un adaptador
  diferido enchufable sin cambiar el dominio.

## Decisiones de alcance pendientes de aprobación humana

Las decisiones de diseño están **razonadas con recomendación** en `design.md` y quedan
**abiertas hasta el OK del Gate SDD**. En particular:
- **D-1**: nueva capability `facturacion` (+ poblar el módulo backend existente) vs extender
  `confirmacion`. Recomendación: **nueva capability** por cohesión del agregado FACTURA.
- **D-2**: **desglose fiscal** — `total = importe_senal`; `base_imponible = round(total /
  1,21, 2)`; `iva_importe = total − base_imponible`; `iva_porcentaje = 21,00` (redondeo
  contable, mitad hacia arriba); la base se deriva del total para que `base + iva = total`.
- **D-3**: **numeración `F-YYYY-NNNN`** secuencial por tenant + año, con constraint
  `UNIQUE(tenant_id, numero_factura)` y reintento ante `P2002`.
- **D-4**: **idempotencia** por `(reserva_id, tipo)` (guarda de existencia + constraint UK).
- **D-5**: **generación de PDF** reutilizando el mecanismo de US-014 (puerto de dominio +
  adaptador de infraestructura, post-commit, `pdf_url` nullable, reintento).
- **D-6**: **endpoints** (`GET /reservas/{id}/factura-senal`, `POST /facturas/{id}/aprobar`,
  `.../rechazar`, `.../regenerar-pdf`) e input para la fase de contrato.
- **D-7**: **migración** — cambiar `numero_factura` a `UNIQUE(tenant_id, numero_factura)` y
  añadir `UNIQUE(reserva_id, tipo)`.
- **D-8**: **concurrencia** — colisión de `numero_factura` entre reservas distintas resuelta
  por el constraint UK + reintento con el siguiente número.
- **D-9**: **borrador inválido** (datos fiscales incompletos) vs **PDF pendiente** (fallo
  temporal): ambos bloquean la aprobación, pero con causas y mensajes distintos.
