# Code Review - US-022 Generar Factura de Senal al Confirmar Reserva

- Rama: feature/us-022-generar-factura-senal
- Base: master (cambios en arbol de trabajo; la rama tiene 0 commits por delante)
- Fecha: 2026-07-04
- Revisor: code-reviewer (solo lectura)

## 1. Resumen ejecutivo

Implementacion solida y fiel a los guardarrailes arquitectonicos de Slotify. El dominio de
facturacion es puro (sin @nestjs / @prisma / infra), la maquina de estados es una tabla
declarativa, el desglose fiscal opera en centimos enteros con IVA por resta (invariante
base + iva = total garantizada y probada), la numeracion F-YYYY-NNNN se serializa por
UNIQUE(tenant_id, numero_factura) mas reintento acotado ante P2002 (sin locks distribuidos),
la multi-tenancy va por JWT mas RLS en todos los adaptadores, y el cliente HTTP del frontend es
una regeneracion byte-identica del contrato (no hay edicion a mano). pnpm run arch pasa sin
violaciones y los 56 tests de dominio/aplicacion estan en verde.

Hallazgo de severidad Alta: la generacion del PDF se ejecuta DENTRO de la transaccion de
creacion/numeracion, contra la decision de diseno D-5 (aprobada por el usuario) que exige
generar el PDF fuera de la transaccion para no sostener locks. No viola ninguna de las 6 reglas
duras (no es Redis, ni infra en dominio, ni tenant del body), por lo que no es Bloqueante
automatico, pero reintroduce un riesgo documentado como mitigado.

Veredicto: APTO CON RESERVA - apto para merge; se recomienda corregir el hallazgo Alta antes o
inmediatamente despues del merge, y limpiar los ficheros de scaffolding de QA.

## 2. Resultado por seccion del checklist

- Hexagonal (dominio sin infra/NestJS): PASS. domain/{calculo-factura,numeracion-factura,factura}.ts sin imports de @nestjs / @prisma / infra (grep vacio). Puertos como interfaces en application/; adaptadores en infrastructure/. depcruise: no dependency violations found (316 modules).
- Bloqueo/concurrencia numeracion: PASS. UK factura_tenant_id_numero_factura_key en migracion; reintento acotado MAX_REINTENTOS_NUMERACION=10 (generar-factura-senal.use-case.ts:271,338); esColisionUnicidad filtra P2002. Sin Redis/Redlock (grep vacio). Test de concurrencia real con Promise.allSettled (10 y 5 facturas): numeros unicos y consecutivos.
- Multi-tenancy / RLS: PASS. tenantId del JWT via CurrentUser (nunca path/body); todos los adaptadores Prisma abren transaccion mas fijarTenant(tx, tenantId) como primera operacion; queries filtran tenant_id.
- Desglose fiscal (Decimal, IVA por resta): PASS. calculo-factura.ts opera en centimos enteros, iva = totalCentimos - baseCentimos; IVA_PORCENTAJE_MVP 21.00. Adaptadores mapean Prisma.Decimal.toFixed(2); crear() usa new Prisma.Decimal(...). Test prueba invariante base+iva=total en 8 totales incluidos 0.01 y 999999.99.
- Idempotencia: PASS. UK factura_reserva_id_tipo_key en migracion; crearOFacturaExistente comprueba buscarPorReservaYTipo antes de crear y audita el intento de duplicado.
- Contrato (DTOs / api-spec / cliente generado): PASS. factura.dto.ts reproduce FacturaSenalDto y RechazarFacturaRequest con class-validator; mapeo 404/409/422/400 coherente con docs/api-spec.yml. El cliente schema.d.ts es byte-identico a la regeneracion (node scripts/generate-client.mjs) tras normalizar CRLF: generado, no editado a mano.
- Frontend (barrel, SDK, importes string, mobile-first): PASS. features/facturacion/index.ts como unica API publica; FichaConsultaPage importa el barrel. Hooks usan apiClient.GET/POST (SDK), sin fetch/axios. lib/dinero.ts trata importes como string solo para formateo. FacturaSenalCard: grid-cols-1 sm:grid-cols-2 lg:grid-cols-3, botones flex-col sm:flex-row, sin anchos px fijos.
- Tests: PASS. 5 ficheros en __tests__/; 56 tests verdes (dominio + use-case). Concurrencia usa BD aislada slotify_test (.env.test) y codigos/emails propios (no reintroduce el deadlock 40P01).
- Convenciones (arrow functions, espanol, sin any): PASS en src/. Sin function declarativo ni any en apps/api/src/facturacion ni apps/web/src/features/facturacion (grep vacio). Errores y comentarios en espanol.
- Responsive (evidencia 390/768/1280): PASS con caveat. QA step-N+3 documenta los 3 viewports por analisis de clases Tailwind (drawer bajo lg, grid/botones responsivos), con limitacion de entorno para el run real de Playwright. Evidencia por analisis de codigo, no por captura en navegador.
- PDF fuera de la transaccion (D-5): FAIL. Ver Hallazgo H-1.

## 3. Hallazgos

### H-1 - [Alta] El PDF se genera DENTRO de la transaccion, contra D-5
- Fichero: apps/api/src/facturacion/application/generar-factura-senal.use-case.ts:340-473 (la llamada a this.deps.generarPdf(...) en :445 y repos.facturas.guardarPdfUrl(...) en :456, ambas dentro del callback de unidadDeTrabajo.ejecutar de :340).
- Regla violada: design.md D-5 (decision aprobada por el usuario): la generacion de PDF fuera de la transaccion evita sostener locks durante una operacion potencialmente lenta; y el riesgo D-1/D-5 (PDF que sostiene locks o revierte la confirmacion, mitigado generando el PDF post-commit, fuera de la transaccion critica).
- Descripcion: todo crearOFacturaExistente (idempotencia + numeracion + creacion + AUDIT_LOG + generarPdf + guardarPdfUrl) corre dentro de la misma transaccion. El header del use-case afirma (3) POST-COMMIT (fuera de la tx), pero el codigo lo ejecuta in-tx. Con el adaptador FAKE actual (sincrono) no hay impacto funcional y los tests pasan; al enchufar el adaptador real (Puppeteer/react-pdf) una generacion lenta mantendria abierta la transaccion y sus locks, justo el anti-patron que D-5 declara mitigado.
- Recomendacion: mover generarPdf + guardarPdfUrl fuera de unidadDeTrabajo.ejecutar, a un paso post-commit (patron ya presente en regenerar-pdf-factura.use-case.ts:112, que genera el PDF antes y solo persiste pdf_url en una tx aparte). La tx critica cierra con la factura en borrador; el PDF se genera despues y actualiza pdf_url en un UPDATE idempotente. No aplicar fix aqui (informe de solo lectura).

### H-2 - [Baja] Ficheros de scaffolding de QA fuera de src/ en el arbol
- Ficheros: apps/api/seed-e2e-dev.js, apps/api/cleanup-e2e-dev.js (untracked).
- Descripcion: usan CommonJS require, function main() declarativo y credenciales postgresql://user:password@localhost:5432/slotify_dev embebidas; apuntan a slotify_dev. Son utilidades de QA E2E, no producto. Al estar fuera de src/ no los cubre ESLint, pero no deberian entrar en el commit de la feature.
- Recomendacion: excluirlos del commit (o moverlos a scripts/ con .gitignore) y evitar credenciales en claro.

### H-3 - [Baja] Evidencia responsive por analisis de codigo, no por run en 3 viewports
- Fichero: openspec/changes/us-022-generar-factura-senal/reports/2026-07-04-step-N+3-e2e-playwright.md.
- Descripcion: la verificacion responsive se sustenta en analisis de clases Tailwind con limitacion documentada del entorno Playwright; no hay capturas reales en los 3 viewports.
- Recomendacion: adjuntar capturas 390/768/1280 de FacturaSenalCard y los dialogos cuando el entorno de navegador este disponible. No bloquea el merge.

### H-4 - [Baja] Idempotencia UNIQUE(reserva_id, tipo) sin tenant_id
- Fichero: apps/api/prisma/migrations/20260704120000_us022_factura_senal_constraints/migration.sql:12.
- Descripcion: la UK de idempotencia no incluye tenant_id. Es funcionalmente correcto porque reserva_id es UUID globalmente unico y una reserva pertenece a un unico tenant, pero se aparta del patron toda restriccion de negocio incluye tenant_id.
- Recomendacion: aceptable como esta; considerar UNIQUE(tenant_id, reserva_id, tipo) por consistencia. No bloquea.

## 4. Veredicto final

APTO (con reserva). No hay hallazgos Bloqueantes ni violacion de las 6 reglas duras de architecture-guardrails. Se recomienda atender H-1 (Alta) - mover la generacion del PDF fuera de la transaccion, conforme a la decision de diseno D-5 aprobada por el usuario - y limpiar H-2 antes de abrir/mergear el PR.

---

## 5. Segunda revision - post-fix

- Fecha: 2026-07-04
- Revisor: code-reviewer (solo lectura)
- Alcance: verificar la correccion de H-1 (Alta) y H-2 (Baja) del primer pass.

### 5.1 Estado de los hallazgos

- H-1 [Alta] - CORREGIDO. La generacion del PDF ya NO corre dentro de la transaccion
  de creacion/numeracion. El cuerpo transaccional `crearOFacturaExistente`
  (generar-factura-senal.use-case.ts:398-482) solo hace idempotencia + numeracion +
  `crear` + AUDIT_LOG `crear`; NO llama a `generarPdf` ni a `guardarPdfUrl`. El PDF se
  genera en el nuevo metodo `generarPdfPostCommit` (:490-527), invocado DESPUES de
  `await this.deps.unidadDeTrabajo.ejecutar(...)` (:382), fuera de la tx critica. El
  guardado de `pdf_url` ocurre en una tx breve e idempotente aparte (:508-510). Un fallo
  transitorio del PDF ya no revierte la creacion commiteada: queda `pdfPendiente=true`,
  `pdf_url=null` (:518-526). El header del use-case (:15-20) y el diseno D-5 quedan
  alineados con el codigo.
- H-2 [Baja] - CORREGIDO. `.gitignore` excluye `apps/api/seed-e2e-dev.js` y
  `apps/api/cleanup-e2e-dev.js` (.gitignore:42-44), bajo la seccion "Scaffolding de QA
  E2E". Los ficheros de scaffolding no entran en el commit de la feature.
- H-3 [Baja] - ACEPTADO. Evidencia responsive por analisis de clases Tailwind, con
  limitacion de entorno Playwright documentada. No bloquea el merge.
- H-4 [Baja] - ACEPTADO. `UNIQUE(reserva_id, tipo)` sin `tenant_id`: funcionalmente
  correcto (reserva_id UUID global, una reserva pertenece a un unico tenant);
  inconsistencia menor con el patron multi-tenant. No bloquea el merge.

### 5.2 Cobertura de tests del comportamiento D-5

El spec `generar-factura-senal.use-case.spec.ts` refleja el comportamiento post-commit:
- 3.6 "debe_generar_el_pdf_DESPUES_de_crear_la_factura_en_la_transaccion" (:378-393):
  asegura orden crear -> pdf.
- Orquestacion "debe_crear_y_numerar_dentro_de_una_unica_unidad_de_trabajo_y_guardar_
  pdf_url_en_tx_aparte_post_commit" (:473-488): asegura DOS unidades de trabajo
  (crear+numerar in-tx; guardar pdf_url post-commit), `generarPdf` fuera de cualquier tx.
- 3.8 (:443-465): fallo transitorio del PDF no revierte la creacion (pdfPendiente=true).

### 5.3 Resultado de comandos ejecutados

- `pnpm exec jest --runInBand --testPathPatterns=facturacion` (apps/api):
  Test Suites: 6 passed, 6 total. Tests: 59 passed, 59 total. Snapshots: 0. En verde.
- `pnpm --filter @slotify/api run arch` (depcruise src):
  no dependency violations found (316 modules, 1098 dependencies cruised). 0 violaciones
  hexagonales.

### 5.4 Veredicto final

Veredicto: APTO. Los hallazgos H-1 (Alta) y H-2 (Baja) del primer pass estan CORREGIDOS;
H-3 y H-4 (Baja) quedan ACEPTADOS y no bloquean. No hay hallazgos Bloqueantes ni violacion
de las 6 reglas duras de architecture-guardrails. La suite de facturacion (59 tests) esta
en verde y el chequeo hexagonal pasa sin violaciones. Apto para merge.
