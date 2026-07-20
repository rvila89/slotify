# Informe de code-review - historial-completo-comunicaciones

**Fecha**: 2026-07-20  **Agente**: code-reviewer
**Rama**: feature/historial-completo-comunicaciones (sobre master 4720987)
**Alcance**: diff completo del worktree (tracked + untracked): migracion, dominio, adaptadores UoW, casos de uso, motor de despacho, contrato OpenAPI + SDK, frontend, tests y artefactos OpenSpec.

---

## Resumen ejecutivo

El change elimina el upsert que sobrescribia la unica E1 por reserva y pasa a INSERTAR una fila por evento del ciclo de vida, etiquetada con un subtipo semantico. La migracion reclava el indice UNIQUE parcial sobre la terna (reserva_id, codigo_email, subtipo) con NULLS NOT DISTINCT y predicado estado enviado. Coherente con proposal/design y el spec-delta; respeta guardrails hexagonal, multi-tenancy, bloqueo atomico; cobertura de tests fiel al invariante. No se detectan bloqueantes.

---

## Verificacion del punto critico - migracion y NULLS NOT DISTINCT

apps/api/prisma/migrations/20260720120000_historial_comunicaciones_subtipo/migration.sql

- Enum SubtipoEmail + columna subtipo nullable: correcto (NULL para E2-E8, manual, filas legadas; sin backfill).
- DROP INDEX del indice actual + CREATE UNIQUE INDEX sobre (reserva_id, codigo_email, subtipo) NULLS NOT DISTINCT WHERE reserva_id IS NOT NULL AND es_reenvio = false AND codigo_email <> manual AND estado = enviado.
- Idempotencia E2-E8 preservada (CORRECTO): con NULLS NOT DISTINCT, dos filas enviado de la misma (reserva, codigo, NULL) siguen colisionando. Verificado por el test debe_rechazar_un_segundo_E2_enviado_subtipo_NULL_por_NULLS_NOT_DISTINCT.
- Coexistencia de subtipos distintos (CORRECTO): dos E1 enviado de subtipos NO nulos distintos coexisten (test debe_permitir_dos_E1_enviado_de_subtipos_DISTINTOS_sin_colision).
- Reenvios y manual fuera del constraint (CORRECTO): se mantienen es_reenvio = false y codigo_email <> manual.
- Legado: filas previas con subtipo NULL no violan la nueva unicidad (a lo sumo una E1 por reserva por el upsert previo; el predicado estado enviado acota).

El comentario de schema.prisma se actualizo en linea con el indice real. Prisma no modela ni el WHERE parcial ni NULLS NOT DISTINCT; van por SQL crudo (patron US-040/045/046).

---

## Checklist de guardrails

### Hexagonal - OK
- comunicaciones/domain/subtipo-email.ts: helper de dominio PURO, sin imports (ni @nestjs/* ni @prisma/* ni infrastructure/). Enum de dominio espejo del enum Prisma; mapeos como arrow.
- comunicacion.repository.port.ts: importa solo dominio (./codigo-email, ./subtipo-email). Los adaptadores hacen el cast a los enums Prisma. Frontera respetada.

### Bloqueo atomico de fecha - OK
- No se introduce Redis/Redlock ni lock distribuido. El nuevo INSERT del borrador E1 (rama 2b y adaptadores UoW) ocurre dentro de la misma transaccion con SELECT FOR UPDATE sobre FECHA_BLOQUEADA. bloquearFecha/liberarFecha intactos.

### Multi-tenancy / RLS - OK
- buscarPorReservaYCodigo y listarPorReserva corren en transaccion con set_config app.tenant_id / fijarTenant; tenantId del JWT, nunca de path/body. Los INSERT/UPDATE tx-bound heredan el contexto RLS.

### Maquina de estados - OK
- La emision de E1 en la rama 2b de cambiar-fecha.use-case.ts no altera estado ni sub-estado; el subtipo (cambio_fecha vs fecha_disponible) se decide por la RAMA del caso de uso, no por if/else dispersos: centralizado en subtipoDesdeTransicion y subtipoDesdeTipoE1. El adaptador no hardcodea el subtipo, lo recibe en params.

### Tipos / DTOs / contrato - OK
- ComunicacionResponseDto.subtipo con ApiPropertyOptional (enum, nullable, required false), tipado SubtipoEmail o null. Sin any injustificado (los cast a SubtipoEmailPrisma son la frontera dominio-Prisma).
- docs/api-spec.yml: nuevo SubtipoEmail (enum) + subtipo nullable en Comunicacion, heredado por ComunicacionListItem via allOf. Descripcion del listado actualizada (historial completo, sin deduplicar). Coincide con los DTOs.
- SDK regenerado: schema.d.ts incluye SubtipoEmail y subtipo opcional/null; client.ts/index.ts sin cambios de logica (solo fin de linea). No editado a mano.
- Importes en Decimal: N/A (este change no toca importes).

### Frontend - OK
- Mapa de etiquetas en features/comunicaciones/lib/subtipo-labels.ts (en lib/, no en components/): cumple components-solo-tsx. Arrow function.
- ComunicacionListaItem.tsx (107 lineas, <=300): etiqueta condicional, clases mobile-first (flex-col ... sm:flex-row, break-words, flex-wrap), sin anchos px fijos.
- Evidencia responsive en 3 viewports (390/768/1280) en el QA report + capturas. El unico overflow a 390 es la deuda pre-existente del app-shell, no lo introduce este change.

### Tests primero (TDD) - OK
- Nuevos: subtipo-email.spec.ts, despachar-email-terna-subtipo.service.spec.ts, historial-comunicaciones-integracion.spec.ts (3 E1 por evento + guarda de regresion por la RUTA DE LECTURA de la app, listarPorReserva).
- Re-expresados fielmente (no vaciados): comunicacion-manual-indice-parcial.integration (regresion US-045 reexpresada a la terna + 3 casos criticos); transicion-fecha-integracion (UNA E1 upsert pasa a DOS filas: enviada legada conservada + borrador nueva); cambiar-fecha.use-case (INSERT del borrador E1 cambio_fecha en rama 2b); cambiar-fecha-en-cola y listar-por-reserva.port ajustados al campo subtipo.
- QA report: suite API GREEN (fallos restantes pre-existentes: react-pdf ESM flakiness y typo EMAIL_TRANSPORT en app.e2e; ninguno toca comunicaciones/reservas).

### Convenciones - OK
- Nombres en espanol, kebab-case en ficheros, camelCase/PascalCase en codigo, comentarios y errores en espanol. Sin function declarativo (arrow functions).

---

## Observaciones (no bloqueantes)

- [Media] buscarPorReservaYCodigo usa findFirst sin orderBy. Con el chequeo del motor clavado a la terna + estado enviado, el indice UNIQUE garantiza a lo sumo una fila que case (determinista en la practica). Un orderBy explicito (fechaCreacion desc) blindaria la intencion frente a usos futuros con estado ausente. Recomendacion.
- [Baja] alta-consulta.use-case.ts (1043 lineas) y otros ficheros backend >300. max-lines <=300 es regla dura de apps/web; en apps/api ya excedian antes (deuda pre-existente). Fuera de alcance.
- [Baja] Doble definicion del tipo TipoE1 (local en alta-consulta + exportado en domain/subtipo-email). No hay conflicto; podria unificarse. Cosmetico.

---

## Conclusion

La implementacion es fiel a la propuesta y al diseno; la migracion preserva correctamente la idempotencia de E2-E8 (verificado NULLS NOT DISTINCT); respeta todos los guardrails duros (hexagonal, bloqueo atomico, multi-tenancy/RLS, SDK generado, components-solo-tsx); y los tests cubren fielmente el invariante nuevo (INSERT-por-evento, terna, coexistencia y colisiones) incluida la guarda de regresion por la ruta de lectura. No hay hallazgos bloqueantes.

Veredicto: APTO
