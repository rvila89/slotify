# 🧾 Historia de Usuario: Generar Factura de Señal al Confirmar Reserva

## 🆔 Metadatos
- ID: US-022
- Área funcional: Confirmación de Reserva
- Módulo: M5 — Confirmación & Facturación
- Prioridad: Crítica
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Sistema
**Cuando se cumple** la transición de `RESERVA` a `reserva_confirmada` (pago de señal confirmado por el gestor en US-021)
**Ejecuto** la generación automática de la factura de señal como borrador con el desglose del 40 % del importe total del presupuesto aceptado
**Para** garantizar que el cobro de la señal queda documentado en una `FACTURA` formal con datos fiscales correctos, disponible para revisión y aprobación del gestor antes del envío en E3

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-18 (principal), UC-17 (contexto disparador — cubierto en US-021)
- Entidades implicadas: `FACTURA`, `RESERVA`, `CLIENTE`, `TENANT`, `TENANT_SETTINGS`, `AUDIT_LOG`
- Dolor(es) que resuelve: D6 (errores en facturación manual: cálculo automático de base imponible + IVA 21 % elimina errores aritméticos), D1 (generación automática elimina el paso manual de crear la factura)
- Automatización relacionada: disparada automáticamente por la transición a `reserva_confirmada`; el gestor solo interviene para revisar y aprobar el borrador
- Email relacionado: E3 — la factura de señal (PDF aprobado) se adjunta en E3 junto con las condiciones particulares; E3 no se envía hasta que el gestor aprueba este borrador
- Reglas de negocio:
  - `RESERVA.estado` debe ser `reserva_confirmada` al generar la factura; solo se genera una factura de señal por reserva (`tipo = 'senal'`)
  - `importe_senal = RESERVA.importe_total × (TENANT_SETTINGS.pct_senal / 100)` — en MVP `pct_senal = 40,00`
  - Desglose fiscal: `base_imponible = importe_senal / 1,21`; `iva_importe = importe_senal − base_imponible`; `iva_porcentaje = 21,00`; `total = importe_senal`
  - `FACTURA.numero_factura` generado secuencialmente por tenant y año: formato `F-YYYY-NNNN`; la secuencia es única por `tenant_id` + año calendario; no puede repetirse (restricción `UK` en BD)
  - PDF generado con datos del emisor (`TENANT.nombre`, `TENANT.nif`, `TENANT.iban`, `TENANT.direccion`), datos del receptor (`CLIENTE.nombre`, `CLIENTE.apellidos`, `CLIENTE.dni_nif`, `CLIENTE.direccion`, `CLIENTE.codigo_postal`, `CLIENTE.poblacion`, `CLIENTE.provincia`), concepto, desglose y total
  - La factura se presenta en `estado = 'borrador'`; el gestor la revisa y puede aprobarla; tras la aprobación, `estado → 'enviada'`
  - El gestor no puede modificar importes ni datos fiscales en el borrador (provienen de `RESERVA` y `CLIENTE`); solo puede aprobar o rechazar el borrador (si rechaza, se señala la incidencia y se bloquea E3)
  - `FACTURA.tipo = 'senal'`; `FACTURA.reserva_id` y `FACTURA.tenant_id` obligatorios
- Supuestos: `CLIENTE` tiene todos los datos fiscales completos (validados en US-014 y en US-021); `RESERVA.importe_total > 0`; `TENANT_SETTINGS.pct_senal` configurado
- Dependencias:
  - US-021 — transición a `reserva_confirmada` es el trigger
  - US-014 — fija `RESERVA.importe_total` desde el presupuesto aceptado
- Notas de alcance:
  - UC-18 no define flujos alternativos explícitos; los edge cases están derivados de las pre/post-condiciones y del modelo de datos
  - La factura de liquidación (60 %) es UC-21, fuera de este lote

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path

- **Dado** que `RESERVA` ha transitado a `reserva_confirmada` con `importe_total = 3.000,00 €`, `TENANT_SETTINGS.pct_senal = 40,00`, `CLIENTE` con datos fiscales completos y `TENANT` con `nombre`, `nif`, `iban` y `direccion` informados
  **Cuando** el sistema genera automáticamente la factura de señal
  **Entonces**:
  - Se crea `FACTURA` con `tipo = 'senal'`, `total = 1.200,00 €`, `base_imponible = 991,74 €` (redondeado a 2 decimales), `iva_importe = 208,26 €`, `iva_porcentaje = 21,00`, `estado = 'borrador'`
  - `FACTURA.numero_factura` generado con formato `F-YYYY-NNNN`, único para el `tenant_id` y año en curso
  - `FACTURA.reserva_id` apunta a la `RESERVA` confirmada; `FACTURA.tenant_id` correcto
  - PDF generado y `pdf_url` almacenada en `FACTURA`
  - El gestor visualiza el borrador en la ficha de la reserva para revisión
  - `AUDIT_LOG` registra `accion = 'crear'`, `entidad = 'FACTURA'`, `entidad_id` de la factura creada

- **Cuando** el gestor revisa el borrador y pulsa "Aprobar factura"
  **Entonces**:
  - `FACTURA.estado` cambia a `'enviada'`
  - `FACTURA.fecha_emision` queda registrado con timestamp actual
  - El sistema marca la factura como lista para adjuntarse en E3
  - `AUDIT_LOG` registra `accion = 'actualizar'` con `datos_anteriores.estado = 'borrador'`, `datos_nuevos.estado = 'enviada'`

### ⚠️ Flujos Alternativos y Edge Cases

#### Datos fiscales del cliente incompletos al generar la factura
- **Dado** que en el momento de generar la factura `CLIENTE.dni_nif` o cualquier campo de dirección fiscal es nulo (escenario de inconsistencia de datos pese a la validación de US-014)
  **Cuando** el sistema intenta generar el PDF de la factura
  **Entonces** el sistema crea la `FACTURA` en `estado = 'borrador'` pero marca el borrador como inválido con alerta "Datos fiscales incompletos"; no genera el PDF; notifica al gestor para que complete los datos del cliente; E3 queda bloqueado hasta resolución
- Comportamiento del sistema: el borrador inválido no puede aprobarse hasta que los datos fiscales estén completos

#### Factura de señal ya existente para la reserva (idempotencia)
- **Dado** que ya existe una `FACTURA` con `tipo = 'senal'` y `reserva_id` de esta reserva (por retry o reinvocación del trigger)
  **Cuando** el sistema intenta generar una segunda factura de señal para la misma reserva
  **Entonces** el sistema detecta la factura existente y no crea un duplicado; devuelve la factura existente al gestor para revisión; `AUDIT_LOG` registra el intento de duplicado
- Comportamiento del sistema: comprobación de existencia con `WHERE reserva_id = X AND tipo = 'senal'` antes de crear

#### Error de generación del PDF
- **Dado** que el servicio de generación de PDF no está disponible temporalmente
  **Cuando** el sistema intenta generar el PDF de la factura
  **Entonces** se crea `FACTURA` con `estado = 'borrador'` y `pdf_url = null`; se registra la incidencia; el gestor recibe alerta "PDF pendiente de regenerar"; el sistema reintenta la generación del PDF de forma automática; la aprobación del borrador queda bloqueada hasta que el PDF esté disponible

#### Gestor rechaza el borrador de la factura
- **Dado** que el gestor visualiza el borrador de la factura de señal y detecta una incidencia (p. ej. datos del tenant incorrectos)
  **Cuando** el gestor pulsa "Rechazar borrador" e indica el motivo
  **Entonces** `FACTURA.estado` permanece en `'borrador'`; se registra el motivo en `AUDIT_LOG`; E3 queda bloqueado; el gestor puede resolver la incidencia (p. ej. corregir datos del tenant en configuración) y regenerar el PDF para volver a revisar

### 🔒 Concurrencia / Race Conditions (zona crítica: número de factura secuencial)

#### Dos reservas distintas del mismo tenant confirmadas de forma concurrente — colisión en numero_factura
- **Dado** dos transacciones concurrentes que intentan crear una `FACTURA` de señal para dos reservas distintas del mismo `tenant_id` en el mismo segundo
  **Cuando** ambas intentan asignar el siguiente número secuencial `F-YYYY-NNNN`
  **Entonces** la restricción `UNIQUE(numero_factura)` de BD garantiza que una de las dos transacciones falla en la inserción; la aplicación reintenta la transacción fallida con el siguiente número disponible; el gestor recibe la factura correctamente numerada sin duplicados; no se produce ninguna factura sin número o con número repetido

### 🚫 Reglas de Validación
- `RESERVA.estado = 'reserva_confirmada'` obligatorio al ejecutar la generación
- `RESERVA.importe_total > 0`
- `TENANT_SETTINGS.pct_senal` ∈ (0, 100), no nulo
- Solo puede existir una `FACTURA` con `tipo = 'senal'` por `reserva_id`
- `CLIENTE.dni_nif`, `direccion`, `codigo_postal`, `poblacion`, `provincia` no nulos para generar el PDF
- `FACTURA.numero_factura` único por `tenant_id` (restricción `UK` en BD)
- Importes redondeados a 2 decimales (redondeo estándar contable: mitad hacia arriba)

## 📊 Impacto de Negocio
- Impacto esperado: elimina la generación manual de facturas de señal (D6, D1); garantiza trazabilidad financiera completa desde el primer cobro; la aprobación del borrador obliga al gestor a revisar los datos antes del envío al cliente, reduciendo errores
- Criterio de éxito: 0 facturas con datos fiscales incorrectos enviadas al cliente; tiempo entre confirmación del pago y borrador disponible para revisión < 10 segundos
