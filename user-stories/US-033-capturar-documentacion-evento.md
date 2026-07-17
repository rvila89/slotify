---
id: US-033
estado: en_revision
branch: feature/us-033-capturar-documentacion-evento
pr: 76
---

# 🧾 Historia de Usuario: Gestor/Equipo captura la documentación obligatoria durante el evento

## 🆔 Metadatos
- ID: US-033
- Área funcional: Ejecución del Evento
- Módulo: M7 (Ficha operativa del Evento — Slotify Brief)
- Prioridad: Alta
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Gestor o miembro del Equipo
**Quiero** capturar y subir desde la vista móvil la documentación obligatoria del evento (foto DNI anverso, foto DNI reverso y cláusula de responsabilidad firmada)
**Para** cumplir con los requisitos legales del espacio y mantener un registro centralizado en Slotify de todos los documentos del evento, eliminando la dispersión en carpetas físicas y drives sin estructura

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-24
- Entidades implicadas: `RESERVA` (`estado = evento_en_curso`, `tenant_id`, `id_reserva`), `DOCUMENTO` (`tipo`: `dni_anverso`, `dni_reverso`, `clausula_responsabilidad`; `reserva_id`, `tenant_id`, `url`, `mime_type`, `tamano_bytes`, `nombre_archivo`), `AUDIT_LOG`
- Dolor(es) que resuelve: D10 (sin fichas organizadas — documentación del evento esparcida en hilos de email, WhatsApp y carpetas físicas), D9 (sin automatizaciones — A30 centraliza la subida), D1 (no hay single source of truth — todo queda en Slotify)
- Automatización relacionada: A30 (Gestor sube documentación el día del evento → Registrar URLs en la reserva + actualizar checklist de documentación)
- Email relacionado: ninguno de E1–E8
- Reglas de negocio:
  - Solo disponible cuando `RESERVA.estado = evento_en_curso`
  - Los tres documentos obligatorios son:
    1. Foto DNI cliente anverso (`DOCUMENTO.tipo = dni_anverso`)
    2. Foto DNI cliente reverso (`DOCUMENTO.tipo = dni_reverso`)
    3. Cláusula de responsabilidad firmada (`DOCUMENTO.tipo = clausula_responsabilidad`)
  - Cada documento se persiste como un registro en `DOCUMENTO` con `reserva_id`, `tenant_id`, `url`, `mime_type`, `tamano_bytes`
  - El checklist se actualiza en tiempo real al subir cada documento
  - Formatos admitidos: imágenes (`image/jpeg`, `image/png`) y PDF (`application/pdf`)
  - La documentación incompleta **no bloquea** la transición a `post_evento` (FA-01 de UC-24): el checklist queda con ítems pendientes pero el gestor puede continuar
  - Si se sube un segundo archivo del mismo tipo para la misma reserva, se crea un nuevo registro `DOCUMENTO` (no se sobreescribe el anterior); el checklist toma el más reciente a efectos de estado
- Supuestos: la vista está optimizada para uso móvil el día del evento; la funcionalidad de subida también está disponible en escritorio para el gestor
- Dependencias: US-031 o US-032 (`RESERVA.estado = evento_en_curso`)
- Notas de alcance: ninguna; UC-24 está completamente dentro del alcance MVP

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path

- **Dado** que `RESERVA.estado = evento_en_curso` y ningún documento del evento ha sido subido aún
  **Cuando** el gestor/equipo accede al checklist de documentación en la vista móvil, selecciona "DNI anverso", toma o selecciona la foto (JPEG) y confirma la subida
  **Entonces**:
  - Se crea un registro `DOCUMENTO` con `tipo = dni_anverso`, `reserva_id = <id reserva>`, `tenant_id = <id tenant>`, `url = <url almacenamiento>`, `mime_type = image/jpeg`, `tamano_bytes > 0`
  - El ítem "DNI anverso" del checklist queda marcado como ✅ completado
  - La acción se registra en `AUDIT_LOG`

- **Dado** que el gestor ha subido el DNI anverso y continúa con los documentos restantes
  **Cuando** sube el DNI reverso y la cláusula de responsabilidad firmada (PDF)
  **Entonces** se crean registros `DOCUMENTO` con `tipo = dni_reverso` y `tipo = clausula_responsabilidad` respectivamente; los tres ítems del checklist quedan marcados como ✅; no hay documentos pendientes en el checklist

### ⚠️ Flujos Alternativos y Edge Cases

#### FA-01 — Documentación incompleta al finalizar el evento
- **Dado** que `RESERVA.estado = evento_en_curso` y solo el DNI anverso ha sido subido (DNI reverso y cláusula pendientes)
  **Cuando** el gestor navega a "Marcar evento como finalizado" (US-034)
  **Entonces** el sistema muestra advertencia: "⚠️ Documentación pendiente: DNI reverso, Cláusula de responsabilidad. Puedes continuar igualmente."; si el gestor confirma la finalización, la transición a `post_evento` se ejecuta sin error; los ítems pendientes permanecen accesibles en la ficha de la reserva en `post_evento` para subida tardía
- Comportamiento del sistema: la documentación incompleta no bloquea el flujo; la alerta es informativa

#### Formato de archivo no admitido
- **Dado** que el usuario intenta subir un archivo `.heic`, `.docx` u otro formato no admitido
  **Cuando** selecciona el archivo y confirma la subida
  **Entonces** el sistema muestra: "Formato no admitido. Por favor, usa JPEG, PNG o PDF."; no se crea ningún registro `DOCUMENTO`; el ítem del checklist no cambia de estado
- Comportamiento del sistema: validación en frontend antes del envío al servidor; no hay intento de persistencia

#### Sustitución de un documento ya subido (archivo incorrecto o borroso)
- **Dado** que ya existe un `DOCUMENTO` con `tipo = dni_anverso` para esta reserva (p. ej. la foto anterior está desenfocada)
  **Cuando** el gestor sube una nueva foto del DNI anverso
  **Entonces** se crea un **nuevo** registro `DOCUMENTO` con `tipo = dni_anverso` y la nueva URL; el checklist muestra el ítem como ✅ (basado en la existencia de al menos un documento del tipo); el registro anterior se conserva en la tabla `DOCUMENTO` (trazabilidad)
- Comportamiento del sistema: no hay "sobreescritura" — se añade el nuevo registro preservando el histórico; el checklist refleja "existe al menos un documento de este tipo"

#### Acceso desde escritorio (no móvil)
- **Dado** que el gestor abre la ficha de la reserva desde un navegador de escritorio con `RESERVA.estado = evento_en_curso`
  **Cuando** sube la documentación usando el formulario de subida estándar (no la cámara del móvil)
  **Entonces** el comportamiento es idéntico: se crean los mismos registros `DOCUMENTO`, el checklist se actualiza; no hay restricción de dispositivo
- Comportamiento del sistema: la vista móvil está optimizada pero no es exclusiva

#### Archivo vacío o corrupto
- **Dado** que el usuario intenta subir un archivo con `tamano_bytes = 0` o un archivo corrupto que no puede ser leído
  **Cuando** se procesa la subida en el servidor
  **Entonces** el sistema rechaza la subida con un error: "El archivo no pudo procesarse. Por favor, inténtalo de nuevo con un archivo válido."; no se crea ningún registro `DOCUMENTO`
- Comportamiento del sistema: validación de tamaño y lectura mínima en el servidor antes de persistir

### 🚫 Reglas de Validación
- Solo disponible cuando `RESERVA.estado = evento_en_curso`
- Formatos admitidos: `image/jpeg`, `image/png`, `application/pdf`
- `DOCUMENTO.tamano_bytes` debe ser > 0
- `DOCUMENTO.reserva_id` es obligatorio (no nullable para documentos de evento)
- `DOCUMENTO.tenant_id` siempre se hereda del tenant de la reserva (aislamiento multi-tenant)
- El checklist refleja el estado de cada tipo de documento basándose en la existencia de al menos un `DOCUMENTO` con ese `tipo` y ese `reserva_id`

## 📊 Impacto de Negocio
- Impacto esperado: centralización de toda la documentación legal del evento en Slotify, accesible en el histórico de la reserva (D10, D1); trazabilidad de subida con `AUDIT_LOG`; vista de checklist mobile-first para el equipo el día del evento (D9)
- Criterio de éxito: ≥80% de reservas en estado `evento_en_curso` con las tres piezas documentales completadas antes de finalizar el evento; 100% de los documentos subidos registrados con URL en `DOCUMENTO` y accesibles en la ficha
