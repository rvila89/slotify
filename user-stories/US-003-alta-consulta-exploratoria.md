---
id: US-003
estado: done
branch: feature/us-003-alta-consulta-exploratoria
pr: null
---

# 🧾 Historia de Usuario: Alta de consulta exploratoria sin fecha de evento

## 🆔 Metadatos
- ID: US-003
- Área funcional: Gestión de Leads y Consultas
- Módulo: M1 — Reserva (entidad central)
- Prioridad: Crítica
- Alcance MVP: ✅ Implementado
- Estado: Hecho
- Owner: PM

## 🎯 Historia
**Como** Gestor
**Quiero** dar de alta un nuevo lead sin fecha de evento confirmada
**Para** registrar el contacto en el sistema como fuente única de verdad y enviar automáticamente una respuesta inicial al cliente, eliminando la dispersión en Gmail/WhatsApp/Sheets

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-03
- Entidades implicadas: RESERVA, CLIENTE, COMUNICACION, AUDIT_LOG, TENANT_SETTINGS
- Dolor(es) que resuelve: D1 (fuente única de verdad), D2 (visibilidad del pipeline), D9 (automatización de respuesta inicial)
- Automatización relacionada: A1 (Lead entra → crear consulta 2.a + email respuesta E1)
- Email relacionado: E1 — auto-envío si campos suficientes sin comentarios; borrador para revisión del gestor si hay comentarios
- Reglas de negocio:
  - Campos obligatorios: nombre, apellidos, email, teléfono, canal_entrada
  - Sin `fecha_evento` → sub-estado inicial 2.a
  - El campo `comentarios` determina el comportamiento de E1: si ausente → auto-envío inmediato; si presente → borrador para que el gestor lo revise y confirme
  - La consulta es una **fase de la RESERVA**, no una entidad separada. Se crea una única entidad RESERVA con estado = 'consulta' y sub_estado = '2a'
  - En sub-estado 2.a no se genera ni asigna entrada en FECHA_BLOQUEADA
  - Se almacena `canal_entrada` para atribución de leads (KPI §7.4); no afecta al flujo ni al comportamiento de E1
  - Campos opcionales (nº invitados, horas, tipo evento) se almacenan si el gestor los introduce; en ausencia de fecha no permiten calcular tarifa exacta
- Supuestos: Toda entrada de lead es alta manual del gestor en MVP, independientemente del canal de origen. Se crea entidad CLIENTE si no existe para este tenant con ese email
- Dependencias: US-001 (Iniciar Sesión — sesión activa requerida). Sin dependencia de bloqueo de fecha ni de cola
- Notas de alcance: La detección automática de cliente recurrente y la vinculación vía `consulta_vinculo` (§4.3 SlotifyGeneralSpecs) son 📐 Solo diseñado en MVP. Esta historia no implementa esa lógica; el gestor puede detectar la recurrencia visualmente si existe pero no hay automatización ni vínculo en BD en MVP

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path — sin fecha, sin comentarios
- **Dado** que el Gestor está autenticado y accede al formulario "Nueva consulta"
  **Cuando** introduce nombre, apellidos, email, teléfono y canal_entrada (sin fecha ni comentarios) y confirma el alta
  **Entonces** el sistema crea una entidad RESERVA con estado = 'consulta', sub_estado = '2a', `ttl_expiracion` = NULL, y no genera ninguna entrada en FECHA_BLOQUEADA

- **Dado** que la RESERVA se ha creado en 2.a sin comentarios
  **Cuando** el sistema procesa el alta
  **Entonces** el email E1 se envía automáticamente al email del cliente sin intervención adicional del gestor, y se registra una fila en COMUNICACION con codigo_email = 'E1', estado = 'enviado'

- **Dado** que el alta y el envío de E1 se han completado
  **Cuando** el sistema finaliza la operación
  **Entonces** se registra una entrada en AUDIT_LOG con accion = 'crear', entidad = 'RESERVA', usuario_id del gestor activo, y los datos de la nueva RESERVA en `datos_nuevos`

### ⚠️ Flujos Alternativos y Edge Cases

#### FA: Lead con comentarios — E1 queda en borrador
- **Dado** que el gestor introduce los datos del lead con el campo `comentarios` relleno
  **Cuando** confirma el alta
  **Entonces** el sistema crea la RESERVA en 2.a y genera una fila en COMUNICACION con codigo_email = 'E1', estado = 'borrador', sin enviarlo al cliente
- Comportamiento del sistema: el email NO se envía hasta que el gestor lo revise, edite si procede, y confirme el envío manualmente. El gestor recibe una alerta en UI indicando que tiene un borrador pendiente de revisar

#### FA: Campos opcionales de tarifa presentes, sin fecha
- **Dado** que el gestor introduce nº de invitados y horas junto con los campos obligatorios, pero sin fecha de evento
  **Cuando** confirma el alta
  **Entonces** el sistema crea la RESERVA en 2.a con los valores opcionales almacenados y E1 se prepara sin cálculo de tarifa exacta (sin fecha no se puede determinar la temporada via UC-16). El envío automático o manual de E1 viene predefinido por el punto anterior: Lead con comentarios - E1 queda en borrador.

#### FA-03: Datos obligatorios incompletos
- **Dado** que el gestor introduce el lead en el formulario con alguno de los campos obligatorios vacíos (nombre, apellidos, email, teléfono o canal_entrada)
  **Cuando** intenta confirmar el alta
  **Entonces** el sistema no crea ningún registro (RESERVA, CLIENTE, COMUNICACION) y muestra errores de validación sobre los campos incompletos
- Comportamiento del sistema: validación en cliente (UI) y en servidor; idempotente si el gestor reintenta con los mismos datos inválidos

#### FA: Email con formato inválido
- **Dado** que el gestor introduce un email con formato inválido (sin '@', sin dominio, etc.)
  **Cuando** intenta confirmar el alta
  **Entonces** el sistema rechaza el formulario con un error de validación en el campo email sin crear ningún registro

#### FA: `canal_entrada` con valor fuera del ENUM
- **Dado** que la petición llega al servidor con un valor de `canal_entrada` no contemplado en el ENUM (web | email | whatsapp | instagram | telefono)
  **Cuando** el sistema valida la solicitud
  **Entonces** retorna error de validación sin crear ningún registro; la UI previene este caso con un selector de opciones

### 🚫 Reglas de Validación
- `nombre` y `apellidos`: no vacíos, máx 100 caracteres
- `email`: formato válido (RFC 5322 básico), obligatorio
- `telefono`: no vacío
- `canal_entrada`: valor dentro del ENUM {web | email | whatsapp | instagram | telefono}
- `fecha_evento`: ausente en este flujo. Si presente, debe ser ≥ hoy (flujo cubierto en US-004)
- `sub_estado` = '2a' cuando `estado` = 'consulta' y `fecha_evento` es NULL
- No se crea fila en FECHA_BLOQUEADA para sub-estado 2.a

## 📊 Impacto de Negocio
- Impacto esperado: Captura el 100% de leads exploratorios en una única fuente de verdad, eliminando el rastro disperso en Gmail, WhatsApp y hojas de cálculo. La respuesta automática (E1) reduce el tiempo de respuesta al cliente de horas a segundos en el caso estándar (D1, D2, D9)
- Criterio de éxito: Tiempo de alta de lead ≤ 2 minutos; tasa de E1 auto-enviado sin intervención del gestor ≥ 70% de las altas sin comentarios
