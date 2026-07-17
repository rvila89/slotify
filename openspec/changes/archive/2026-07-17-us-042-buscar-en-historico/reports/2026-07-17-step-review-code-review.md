# Code Review — US-042 Buscar y filtrar en el histórico

- Fecha: 2026-07-17
- Rama: feature/us-042-buscar-en-historico (comparada contra master; cambios en árbol de trabajo, sin commit)
- Revisor: code-reviewer (solo lectura, sin auto-fix)
- Alcance: backend hexagonal GET /historico, migración GIN FTS, frontend features/historico/, contrato OpenAPI + SDK regenerado.

## Resumen

Implementación limpia y alineada con los guardarraíles duros de Slotify. Backend hexagonal correcto, multi-tenancy explícito en el WHERE, full-text 100% parametrizado con expresiones to_tsvector idénticas entre WHERE e índices GIN, contrato desacoplado del pipeline y SDK regenerado (no editado a mano). No hay hallazgo Bloqueante ni Alto. Solo observaciones menores (documentación/QA).

## Hallazgos por severidad

### Bloqueantes
- Ninguno.

### Altas
- Ninguna.

### Medias
- Ninguna.

### Bajas

1. [QA/documentación] Nombres de componentes en el report de tests no coinciden con el código. El report step-unit-tests.md lista HistoricoSearchBar, HistoricoFilters, HistoricoList, HistoricoEmptyState que NO existen en disco; los reales son HistoricoFiltros, HistoricoTabla, HistoricoEstados, HistoricoSkeleton. Deriva del report, no del código. Recomendación: actualizar el report. No afecta al veredicto.

2. [QA/documentación] El report de curl usa "meta" en vez de "metadata". step-manual-curl.md muestra { "data": [], "meta": {...} }. El contrato y el DTO reales usan metadata (PaginationMetadata). Es taquigrafía del report, no un mismatch del código. Recomendación: corregir el ejemplo.

3. [contrato - placeholder deprecado] GET /historico/reservas marcado deprecated: true en vez de eliminado. Dictamen: ACEPTABLE. El placeholder NO tiene operationId, por lo que el generador de SDK no produce método cliente para él (verificado en schema.d.ts: solo aparece listarHistorico para /historico). Es spec muerta e inofensiva: no genera superficie de API nueva ni riesgo de uso accidental. Mantenerlo deprecated con nota de sustitución es higiene de contrato razonable. Recomendación NO bloqueante: eliminarlo del todo en un change de limpieza de contrato posterior.

## Verificación de los puntos de atención

1. Hexagonal/DDD - CORRECTO. domain/listar-historico.port.ts define el puerto HistoricoQueryPort + read-models sin imports de @nestjs/*, @prisma/* ni infrastructure/. La aplicación depende solo del puerto inyectado. El adapter Prisma es el único que importa Prisma/@nestjs/common. Controller con @Controller('historico') + @UseGuards(JwtAuthGuard); cableado en reservas.module.ts via factories y token HISTORICO_QUERY_PORT.

2. Multi-tenancy/RLS - CORRECTO. tenant_id deriva SIEMPRE del JWT (@CurrentUser().tenantId); nunca del query/path/body (el DTO no expone tenantId). Aislamiento en profundidad: fijarTenant(tx) (SET LOCAL app.tenant_id) como primera operación de la transacción Y filtro explícito r.tenant_id = param como primera condición del WHERE en SELECT y COUNT, parametrizado. Cubre el bypass del superuser de RLS en dev/test.

3. Full-text parametrizado + índices idénticos - CORRECTO. El término q viaja siempre como parámetro de plainto_tsquery (nunca concatenado); las demás condiciones son parámetros con cast (::date, ::numeric, casts de enum). Sin inyección SQL. Las dos expresiones to_tsvector del WHERE (adapter lineas 95-102) son EXACTAMENTE iguales a las de los índices GIN de la migración 20260717140000_us042_historico_fts_gin (RESERVA: codigo+notas; CLIENTE: nombre+apellidos+translate(email,'@._-',cuatro espacios)). El translate del email que arregla la búsqueda por fragmento está presente e idéntico en WHERE e índice, así que el planificador puede usarlos. Partición en dos documentos por tabla combinados con OR: correcto.

4. Arrow functions + responsive - CORRECTO. Cero funciones declarativas en features/historico/ (grep 0 matches). Mobile-first: HistoricoTabla se refluye a tarjetas apiladas en <lg (data-label + sr-only/not-sr-only, sin overflow); HistoricoFiltros en grid 1 -> sm:2 -> lg:3. Nav lateral colapsa a drawer via App Shell existente (nav item Histórico añadido a navigation.ts). QA aporta evidencia en 3 viewports (390/768/1280) + drawer abierto en reports/e2e-screenshots/.

5. Guardrail components/ solo .tsx + <=300 lineas - CORRECTO. Todos los .ts no-componente en lib/ (filtros, formato, constants, destacar, detalle, estilos) o model/types.ts; bajo components/ solo .tsx. Fichero mayor: HistoricoFiltros.tsx con 170 lineas. Barrel index.ts como única API pública; DetalleHistorico/ co-localiza sus components/. Import cruzado de feature por barrel (useReserva desde @/features/reservas).

6. Contrato - CORRECTO; placeholder deprecado ACEPTABLE (ver Baja 3). GET /reservas (pipeline US-049) NO se tocó. Schema ReservaHistorico propio (fila ligera, no reutiliza Reserva); envoltorio ReservaHistoricoListResponse reutiliza PaginationMetadata. DTOs class-validator (limit 1..100, page>=1, estadoFinal restringido a los dos cerrados, tipoEvento al enum, fechas YYYY-MM-DD, importes Decimal como string). Importes como string Decimal(10,2) via toFixed(2), nunca Float.

7. SDK generado, no editado a mano - CORRECTO. El único cambio en apps/web/src/api-client/ es schema.d.ts (regenerado); el wrapper client.ts/index.ts no se tocó. El diff de schema.d.ts corresponde exactamente al delta de api-spec.yml. Los tipos del frontend aliasan el SDK (model/types.ts).

## Checklist de calidad (resto)

- Bloqueo de fecha: N/A (lectura pura, sin bloquearFecha/liberarFecha, sin Redis/lock distribuido).
- Máquina de estados: N/A (no hay transiciones; solo lee estados terminales).
- Jobs asíncronos: N/A.
- Errores en español: OK.
- TS strict sin any injustificado: OK (0 any en adapter y feature).
- Tests primero: OK. Existen listar-historico.use-case.spec.ts, listar-historico.controller.http.spec.ts y listar-historico-integracion.spec.ts (backend) + tests de frontend. Ejecutados en esta revisión: use-case + controller HTTP = 22 tests PASS. El spec de integración requiere Postgres real; QA lo reporta verde contra slotify_test.
- Convenciones de nombres en español: OK.

## Veredicto: APTO
