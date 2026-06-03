# 🧾 Historia de Usuario: Exportar Reservas a CSV

## 🆔 Metadatos
- ID: US-043
- Área funcional: Histórico
- Módulo: M1 — Reservas (Pipeline, Histórico, Ficha y Cola)
- Prioridad: Media  (heredada de UC-33)
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Gestor
**Quiero** exportar a un archivo CSV el conjunto de reservas resultante de los filtros activos en el histórico o en el pipeline
**Para** analizar los datos fuera del sistema, compartirlos con terceros (asesoría fiscal, gestoría) o integrarlos con herramientas externas de reporting sin depender de exportaciones manuales

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-33
- Entidades implicadas: `RESERVA`, `CLIENTE`
- Dolor(es) que resuelve: D5 (datos del histórico exportables y centralizados en el sistema, no dispersos en hojas de cálculo), D1 (gestión integral con salida de datos estructurada), D9 (elimina la exportación manual fila a fila desde el sistema anterior)
- Automatización relacionada: ninguna (acción manual del Gestor bajo demanda)
- Email relacionado: ninguno
- Reglas de negocio:
  - El CSV se genera a partir del **conjunto de reservas visible en el momento de la exportación**, respetando todos los filtros activos. Si no hay filtros, se exportan todas las reservas accesibles.
  - El CSV incluye los atributos de negocio de `RESERVA` (código, estado, sub_estado, fecha_evento, tipo_evento, duración, nº invitados, importe total, importe señal, importe liquidación, canal de entrada, fecha de creación) y los datos del `CLIENTE` asociado (nombre, apellidos, email, teléfono).
  - El CSV **no incluye** campos internos de infraestructura ni datos sensibles no operativos: `password_hash`, `iban` del tenant, `iban_devolucion` del cliente (IBAN de devolución de fianza es dato sensible), IDs internos de entidades de infraestructura.
  - La exportación puede lanzarse tanto desde la vista Histórico como desde la vista Pipeline (reservas activas); el área funcional de ambas vistas es la misma operación técnica con conjuntos de datos distintos.
  - Aislamiento multi-tenant: el CSV solo contiene datos del `tenant_id` del JWT activo.
  - La generación es síncrona para volúmenes del MVP (1 tenant, máximo estimado de cientos de registros); se descarga directamente en el navegador sin proceso asíncrono.
- Supuestos:
  - El número de reservas exportables en el MVP (1 tenant) es suficientemente pequeño para una descarga síncrona en < 5 segundos. Si en el futuro se superan umbrales de rendimiento, se puede migrar a generación asíncrona sin cambiar la interfaz del Gestor.
  - El encoding del archivo es UTF-8 con BOM para compatibilidad con Microsoft Excel en Windows (negociable).
  - El separador de columnas es coma (`,`) por defecto; puede ser punto y coma (`;`) si el tenant lo necesita para Excel en locales europeos (configuración negociable, no bloqueante para MVP).
- Dependencias:
  - US-001 (sesión activa) como precondición de acceso.
  - US-042 (histórico) como contexto habitual donde se aplican los filtros previos a la exportación, aunque la operación puede ejecutarse también desde la vista de Pipeline sin pasar por el histórico.
- Notas de alcance: UC-33 es exportación de datos existentes (`✅ Implementado`). La **importación CSV de reservas históricas** está en la lista negra explícita del prompt (`📐 Solo diseñado`): no se genera historia para esa funcionalidad. El campo `RESERVA.iban_devolucion` (`CLIENTE.iban_devolucion`) se excluye del CSV por ser dato financiero sensible que no aporta valor en el análisis operativo habitual; si en el futuro el tenant necesita exportarlo, es una decisión de configuración por rol.

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path

- **Dado** que el Gestor está en la vista Histórico con el filtro "tipo de evento: boda" activo y hay 12 reservas completadas que cumplen el filtro
  **Cuando** selecciona el botón "Exportar CSV"
  **Entonces** el navegador inicia la descarga de un archivo `.csv` (p. ej. `slotify-reservas-2026-05-30.csv`) con exactamente 12 filas de datos (más la fila de cabecera), conteniendo los campos de negocio de `RESERVA` y `CLIENTE` declarados en las reglas de negocio

- **Dado** que el Gestor descarga el CSV con filtros activos
  **Cuando** abre el archivo en una hoja de cálculo
  **Entonces** las columnas están correctamente separadas, los textos con comas están entrecomillados, las fechas están en formato ISO 8601 (`YYYY-MM-DD`) y los importes son numéricos con punto decimal; el archivo no contiene `password_hash`, `iban` del tenant ni `iban_devolucion` del cliente

- **Dado** que el Gestor está en la vista Pipeline (reservas activas) sin ningún filtro aplicado
  **Cuando** selecciona "Exportar CSV"
  **Entonces** el navegador descarga un CSV con todas las reservas activas del tenant (`RESERVA.estado NOT IN ('reserva_completada', 'reserva_cancelada', '2x', '2y', '2z')`), con los mismos campos que el histórico

### ⚠️ Flujos Alternativos y Edge Cases

#### Conjunto de reservas vacío al exportar
- **Dado** que el Gestor ha aplicado filtros tan restrictivos que el conjunto de resultados está vacío (0 filas)
  **Cuando** selecciona "Exportar CSV"
  **Entonces** el sistema descarga un archivo CSV que contiene únicamente la fila de cabecera (con los nombres de columna), o bien muestra un mensaje informativo previo a la descarga: "No hay reservas que coincidan con los filtros actuales. ¿Deseas exportar de todos modos?"
- Comportamiento del sistema: se prioriza no bloquear al gestor; la descarga de un CSV con solo cabecera es válida. La confirmación previa es una decisión de UX negociable.

#### Exportación sin filtros desde el histórico completo
- **Dado** que el Gestor accede al Histórico sin aplicar ningún filtro y hay 150 reservas completadas
  **Cuando** selecciona "Exportar CSV"
  **Entonces** el sistema genera y descarga un CSV con las 150 filas de datos, sin truncar ni paginar el resultado (la exportación no está sujeta a paginación de UI)
- Comportamiento del sistema: la exportación recorre el conjunto completo de resultados, no solo la página visible en la tabla.

#### Aislamiento multi-tenant en la exportación
- **Dado** que el JWT del Gestor contiene `tenant_id = 'T-001'`
  **Cuando** el sistema genera el CSV
  **Entonces** el archivo contiene exclusivamente filas de `RESERVA.tenant_id = 'T-001'`; ningún dato de otros tenants aparece en el CSV aunque la query interna no especifique filtro explícito por el Gestor
- Comportamiento del sistema: `tenant_id` del JWT es condición obligatoria e inyectada en el backend; el Gestor no puede modificarla.

#### Caracteres especiales en campos de texto
- **Dado** que el nombre de un cliente contiene una coma (p. ej. "Martínez, S.L.") o comillas dobles en las notas
  **Cuando** el sistema genera el CSV
  **Entonces** esos campos aparecen correctamente entrecomillados (`"Martínez, S.L."`) o con las comillas escapadas, de forma que el archivo puede parsearse sin errores por cualquier lector CSV estándar (RFC 4180)
- Comportamiento del sistema: la generación del CSV respeta el estándar RFC 4180 para el escape de caracteres especiales.

### 🔒 Concurrencia / Race Conditions (solo zonas críticas)
Esta historia es de **lectura pura**; no muta ninguna entidad. La generación del CSV es una operación síncrona de serialización de datos ya persistidos. No hay ventanas de carrera relevantes: si una reserva cambia de estado entre la generación del CSV y su descarga (tiempo < 1 s), el CSV refleja el snapshot en el momento de la petición, lo cual es el comportamiento esperado y correcto.

### 🚫 Reglas de Validación
- El acceso a la exportación requiere sesión autenticada (`USUARIO.activo = true`, JWT válido).
- El CSV **no puede contener** los siguientes campos bajo ninguna circunstancia: `USUARIO.password_hash`, `TENANT.iban`, `CLIENTE.iban_devolucion`, tokens internos, `ip_address` ni `user_agent` de `AUDIT_LOG`.
- El filtro por `tenant_id` es **obligatorio e implícito** en la query de exportación; no puede ser omitido.
- El endpoint de generación del CSV debe estar protegido por autenticación JWT con el mismo middleware que el resto de la API; no debe ser accesible públicamente.
- La exportación no incluye datos de `AUDIT_LOG`, `PAGO` ni `DOCUMENTO` (URLs de archivos); solo datos de negocio de `RESERVA` y `CLIENTE` descritos en las reglas de negocio.

## 📊 Impacto de Negocio
- Impacto esperado: el Gestor puede generar en segundos un informe de reservas filtradas por temporada, tipo de evento o período para entregarlo a la gestoría o analizarlo en Excel, eliminando la transcripción manual de datos desde el sistema anterior (Sheets, papel). La funcionalidad también habilita la conciliación contable periódica sin necesidad de acceso externo al sistema.
- Criterio de éxito: el Gestor puede descargar un CSV con las reservas del último año en < 5 segundos y el archivo se abre correctamente en Microsoft Excel sin errores de codificación ni columnas mal parseadas (validable con test de integración de generación de CSV + test manual con el gestor de Masia l'Encís).
