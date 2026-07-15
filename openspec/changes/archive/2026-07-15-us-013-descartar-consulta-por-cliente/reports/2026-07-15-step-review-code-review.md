# Code Review - US-013 Marcar consulta como descartada por cliente -> 2.z

- Change: us-013-descartar-consulta-por-cliente
- Rama: feature/us-013-descartar-consulta-por-cliente
- Fecha: 2026-07-15
- Alcance revisado (diff vs master): dominio maquina-estados, use-case, adaptador UoW Prisma, DTO, controller, modulo, tokens; frontend feature reservas (api/lib/components/pages/barrel); contrato docs/api-spec.yml; SDK regenerado apps/web/src/api-client/schema.d.ts; 3 archivos de tests (uno [requires-real-db]).
- Naturaleza: revision de solo lectura contra review-checklist + architecture-guardrails. No se aplican fixes.

---

## Veredicto: APTO

Con dos condiciones de cierre (NO bloqueantes de calidad de codigo, pero SI requisitos de gate):

1. El codigo esta APTO desde arquitectura, guardrails, contrato y diseno.
2. El cierre del change (archive/PR) queda condicionado a re-ejecutar y aprobar los pasos de QA contra BD real (curl N+2, E2E N+3, concurrencia [requires-real-db]), hoy PENDIENTES / desactualizados respecto al fix ya aplicado. Ver seccion QA pendiente.

No hay Bloqueantes.

---

## Bloqueantes

Ninguno.

---

## Dictamen sobre el punto #1 - Desviacion de auditoria (traza FECHA_BLOQUEADA / causa descarte)

Dictamen: ACEPTABLE. Cumple el spec-delta y la US. Deuda documentable (observacion menor), NO bloqueante.

Analisis:

- El adaptador descartar-consulta-uow.prisma.adapter.ts NO invoca el LiberarFechaService compuesto; libera la fila con SELECT FOR UPDATE + DELETE inline (liberarFechaEnTx) dentro de la misma transaccion, para no anidar transacciones. Esto replica exactamente el precedente vivo promocion-cola-uow.prisma.adapter.ts (que tambien inlinea la mecanica atomica y solo emite AUDIT_LOG con entidad RESERVA, sin traza FECHA_BLOQUEADA).
- Consecuencia: en 2b/2c/2v NO se emite la traza AUDIT_LOG con entidad FECHA_BLOQUEADA / causa descarte (esa traza la produce LiberarFechaService, que aqui no se usa).
- Contraste con la fuente de verdad:
  - El Requirement Auditoria de la transicion a 2.z sin duplicar la liberacion de fecha exige AUDIT_LOG accion transicion, entidad RESERVA, datos_anteriores.sub_estado=origen y datos_nuevos.sub_estado=2z. El adaptador lo cumple (paso 5, tx.auditLog.create; en 2d datos_nuevos refleja la salida de cola).
  - El mismo Requirement dice que la auditoria de la liberacion la registra liberarFecha (entidad FECHA_BLOQUEADA, causa descarte) y que esta transicion NO DEBE duplicarla. El texto presupone que quien libera es liberarFecha. NO exige de forma independiente que exista una traza FECHA_BLOQUEADA/descarte: solo exige la traza de la RESERVA y prohibe duplicar la de la liberacion.
  - La US-013 CA / Happy Path solo exige la traza de la transicion RESERVA -> 2z.
- Conclusion: la ausencia de la traza FECHA_BLOQUEADA/descarte NO viola ningun requirement (nadie la exige como obligatoria; solo se prohibe duplicarla). El diseno reutiliza la mecanica de liberacion (SELECT FOR UPDATE + DELETE serializado + UNIQUE(tenant,fecha)) sin la envoltura de servicio que la audita, igual que el precedente ya en master.

Recomendacion (deuda documentable, no bloqueante): dejar constancia de que las liberaciones de fecha por UoW inline (promocion de cola y ahora descarte) NO producen la fila de auditoria entidad FECHA_BLOQUEADA. Si se exigiera trazabilidad forense completa por fila de liberacion, haria falta un change transversal que unifique esa auditoria para todos los caminos inline. Para US-013 el comportamiento es coherente con el spec y el precedente.

---

## Confirmacion del punto #2 - Fix del cast a uuid

CONFIRMADO. El fix esta aplicado en el codigo.

- No queda ningun cast a uuid en el adaptador (busqueda de doble-dos-puntos uuid -> 0 resultados). Los binds de id_reserva, tenant_id y consulta_bloqueante_id viajan como parametros de texto sin cast, coherente con el schema Prisma: esas columnas son String mapeadas SIN db.Uuid (se almacenan como text/varchar). El cast a uuid sobre columnas text era la causa del 500 reportado en el Step N+2.
- El unico cast que queda es a date sobre la columna fecha en liberarFechaEnTx (lineas 246 y 251), y es correcto: la columna fecha de fecha_bloqueada es tipo date y fechaIso es un dia YYYY-MM-DD; fecha_evento en reserva es db.Date. El count/update de cola usan SubEstadoPrisma.s2d y el literal s2d, alineado con el enum SubEstadoConsulta s2d del schema.

Salvedad importante: los reports de QA N+2 (curl) y N+3 (E2E) siguen reflejando el estado PRE-fix (N+2 = FAIL con 500; N+3 = bloqueado). El fix esta en el codigo pero NO ha sido re-verificado contra BD real. Debe re-ejecutarse (ver QA pendiente).

---

## Guardrails verificados (OK)

Hexagonal / DDD
- domain/maquina-estados.ts: MAPA_DESCARTE_CLIENTE + resolverDescarteCliente puros, sin imports de nestjs, prisma ni infrastructure. Coherente con el hook no-infra-in-domain.
- application use-case: solo orquesta; define el puerto DescarteConsultaUoWPort y errores de dominio; sin Prisma ni framework.
- infrastructure uow adapter: implementa el puerto; toda la mecanica Prisma/lock vive aqui.

Bloqueo atomico
- Liberacion via primitiva Postgres (SELECT FOR UPDATE sobre fecha_bloqueada + DELETE, apoyado en UNIQUE(tenant_id, fecha)), dentro de UNA sola transaccion. Sin Redis/Redlock/locks distribuidos (hook no-distributed-lock respetado).
- fijarTenant(tx, tenantId) es la PRIMERA operacion de la transaccion (RLS activo).
- Guarda de origen re-evaluada BAJO el lock (SELECT FOR UPDATE sobre la fila RESERVA -> resolverDescarteCliente) - base de RC-1/RC-3.
- Promocion A15: reutiliza el seam PromocionColaPort.promoverPrimeroEnCola post-commit y exactamente una vez (flag planPromocion.disparar, gobernado por hayColaApuntando). No redefine la mecanica.

Maquina de estados
- Transicion declarativa en tabla (MAPA_DESCARTE_CLIENTE), no if/else dispersos. Origenes validos exactamente 2a/2b/2c/2d/2v; terminales y no-origenes -> null (rechazo). Destino siempre 2z (distinto de 2x/2y, D-4).
- Origen terminal -> 409 transicion_no_permitida (NO 422). Correcto (F5-02 = conflicto de estado).

Multi-tenancy
- tenantId/usuarioId derivan del JWT (CurrentUser), nunca del path/body. El id es solo la RESERVA objetivo. RLS fijado en tx.

Contrato + SDK
- Endpoint POST /reservas/{id}/descartar, operationId descartarConsultaPorCliente, request DescartarConsultaRequest (motivo opcional, additionalProperties false), 200 Reserva, 401/403/404, 409 DescartarConsultaConflictError con code transicion_no_permitida. Coherente con el spec-delta.
- DTO backend refleja el contrato (camelCase, IsOptional + IsString). Importes como string (Decimal), no Float.
- SDK schema.d.ts regenerado coincide con el contrato; sin senales de edicion a mano.

Motivo anexado (no sobrescrito)
- anexarMotivo: notas_previas + salto de linea + marca [descarte cliente] + motivo; sin notas previas arranca con la marca. Cumple la decision del Gate (append). Sin motivo, notas no se toca (update condicional).

Reordenacion de cola 2d
- decrementarCola: UPDATE posicion_cola = posicion_cola - 1 WHERE consulta_bloqueante_id = B AND posicion_cola > P. La bloqueante no se toca, no libera fecha, no promueve. La salida propia pone posicion_cola/consulta_bloqueante_id -> NULL. Preserva contiguidad y el indice UNIQUE(tenant_id, consulta_bloqueante_id, posicion_cola).

Frontend
- Arrow functions en todo. Estructura Bulletproof: useDescartarConsulta en api/, puedeDescartarConsulta y MENSAJE_DESCARTE_TERMINAL en lib/ (no en components/), DescartarConsultaDialog y AccionDescartar son .tsx en components/. Exportados por el barrel features/reservas/index.ts.
- TanStack Query: tras exito setQueryData(reservaQueryKey) + invalida reservaQueryKey y reservasActivasQueryKey (pipeline/cola) - correcto porque promocion/reordenacion son invisibles en la respuesta.
- Manejo 409: normaliza a tipo conflicto y muestra el mensaje del contrato inline; RC-3 cubierto.
- Boton deshabilitado en terminales (puedeDescartarConsulta), visible solo en fase consulta. Guarda de servidor defensiva e independiente.
- Responsive: patron mobile-first (footer flex-col gap-3 sm:flex-row, botones w-full sm:w-auto, contenedor con overflow-y-auto, objetivos tactiles h-12/h-14). Consistente con ArchivarReservaDialog. Sin evidencia de los 3 viewports (390/768/1280) por estar el E2E pendiente -> ver observacion.

Tipos / TS strict
- Sin any injustificado. Los cast a Prisma.InputJsonValue y a SubEstadoPrisma son casts de frontera Prisma habituales y acotados. Interfaces tipadas para filas crudas.

Convenciones
- Nombres en espanol, comentarios y errores en espanol. Mensaje 409 literal alineado entre dominio, contrato, SDK y frontend.

---

## QA pendiente (condiciona el cierre, NO la calidad del codigo)

Los pasos de QA contra BD real estan PENDIENTES o desactualizados y deben re-ejecutarse desde la sesion principal (los subagentes QA no tienen Postgres):

- Step N+1 (unit/mock): VERDE en lo ejecutable (dominio + app + frontend). La suite de concurrencia [requires-real-db] quedo PENDIENTE.
- Step N+2 (curl): reporta FAIL por el bug del cast a uuid - ya corregido en codigo pero NO re-verificado. Re-lanzar los 6 origenes + FA terminal (409) + 404 + 401/403 contra BD real y confirmar 200/estado en BD.
- Step N+3 (E2E Playwright): PENDIENTE (estaba bloqueado por el bug de N+2). Ejecutar el flujo completo en la ficha (con/sin motivo, boton deshabilitado, 409) y verificar los 3 viewports (390/768/1280) con capturas en reports/e2e-screenshots/.
- Concurrencia RC-1/RC-2/RC-3 [requires-real-db]: PENDIENTE contra Postgres real.

No consta que QA este verde contra BD real. Este informe emite veredicto sobre la CALIDAD DEL CODIGO/DISENO; el hook require-code-review queda satisfecho, pero el gate final exige ademas que estos pasos de QA pasen.

---

## Observaciones no bloqueantes / deuda

1. Auditoria de FECHA_BLOQUEADA (punto #1): aceptable y alineada con el precedente; documentar como deuda transversal si se quiere trazabilidad forense por fila de liberacion.
2. Reports N+2/N+3 desactualizados: reflejan el estado pre-fix; actualizarlos tras la re-ejecucion contra BD real para que el historial no induzca a error.
3. Evidencia responsive: el codigo es mobile-first y consistente con el patron vecino, pero falta la evidencia de los 3 viewports (dependia del E2E). Aportarla en N+3.
4. hayColaApuntando + promocion post-commit: mismo patron que liberarFecha. Correcto; el test de concurrencia RC real debe confirmar que no hay doble disparo (el seam ya es idempotente por su guarda ya-promovida).

---

## Trazabilidad

- Spec-delta: openspec/changes/us-013-descartar-consulta-por-cliente/specs/consultas/spec.md (9 requirements, capability consultas).
- Design: openspec/changes/us-013-descartar-consulta-por-cliente/design.md (D-1..D-6 + ambiguedades del gate).
- US: user-stories/US-013-marcar-consulta-descartada-por-cliente.md.

Veredicto: APTO
