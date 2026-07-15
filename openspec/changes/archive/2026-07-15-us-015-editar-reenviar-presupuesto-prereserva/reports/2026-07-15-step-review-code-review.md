# Code Review — US-015 Editar y Reenviar Presupuesto en Pre-reserva

**Fecha**: 2026-07-15  
**Agente**: code-reviewer (solo lectura)  
**Alcance**: working tree de la feature vs master (la rama apunta al mismo commit que
master; los cambios de US-015 estan en el arbol de trabajo, no committeados). Backend
apps/api/src/presupuestos/* + reservas/domain/maquina-estados.ts; frontend
apps/web/src/features/presupuestos/* y .../FichaConsulta/*; contrato docs/api-spec.yml
+ cliente generado.

---

## Veredicto

Veredicto: APTO

No se detectaron bloqueantes. Se listan observaciones no bloqueantes (una ya conocida
y aceptada por el gate/QA) y deudas pre-existentes ajenas a esta US.

---

## Guardrails duros — resultado

| # | Guardrail | Resultado |
|---|-----------|-----------|
| 1 | Hexagonal / DDD | PASA |
| 2 | Multi-tenancy / RLS (tenant del JWT) | PASA |
| 3 | Bloqueo atomico (no tocar FECHA_BLOQUEADA / sin Redis) | PASA |
| 4 | Maquina de estados declarativa | PASA |
| 5 | Contrato (cliente generado, DTOs alineados) | PASA |
| 6 | Estilo (arrow fns, Bulletproof, max-lines, responsive) | PASA |
| 7 | Numeracion / versionado / congelado (D1-D3) | PASA |

### 1. Hexagonal / DDD
- application/editar-presupuesto.use-case.ts depende SOLO de puertos inyectados; no importa @nestjs/*, @prisma/* ni infrastructure/ (unica mencion es un comentario). eslint limpio.
- Los adaptadores Prisma (lecturas, UoW, reenvio) implementan los puertos y se cablean por token en presupuestos.module.ts con useFactory/inject.
- El use-case de REENVIO no expone puertos de version/numeracion/UoW (D2.4).

### 2. Multi-tenancy / RLS
- tenant_id y usuario_id SIEMPRE del JWT via @CurrentUser en el controller; nunca del path/body. El id de la reserva viaja por path solo como filtro.
- La UoW llama fijarTenant(tx, tenantId) como primera operacion (SET LOCAL RLS). Todos los adaptadores de lectura y el de reenvio repiten $transaction + fijarTenant. Las queries filtran ademas por tenantId explicito. Sin fugas cross-tenant.
- Guard de rol Roles(gestor) + RolesGuard a nivel de controller.

### 3. Bloqueo atomico
- La US NO toca FECHA_BLOQUEADA ni introduce Redis/Redlock/locks distribuidos. La UoW de edicion NO expone repositorio de bloqueo ni de RESERVA; un test asserta repos sin fechaBloqueada y la no-mutacion de estado/ttl. QA de BD real confirma TTL y estado intactos.
- Concurrencia de doble edicion: unique(reservaId, version) + reintento acotado ante P2002 recalculando MAX+1 (max 10), discriminando el target del indice; cualquier otro P2002 propaga (rollback). Sin locks distribuidos.

### 4. Maquina de estados declarativa
- Nueva guarda esEstadoValidoParaEditarPresupuesto sobre la tabla declarativa ESTADOS_VALIDOS_EDITAR_PRESUPUESTO = [pre_reserva]. Precondicion de estado (no arista del grafo), consistente con US-024/US-006. Sin if/else dispersos. La 2a vertiente (ultimo PRESUPUESTO en borrador/enviado) se valida en el use-case.
- Estado invalido -> 409 RESERVA_FUERA_DE_PRERESERVA; PRESUPUESTO aceptado/rechazado -> 409 PRESUPUESTO_NO_EDITABLE; validaciones -> 422. Mapeo HTTP correcto.

### 5. Contrato
- Cliente generado NO editado a mano: regenerado y el diff de schema.d.ts es identico al ya presente (sin drift); client.ts/index.ts sin cambios.
- DTOs alineados con los schemas del contrato, validados con class-validator. Importes como string Decimal (regex 2 dec), no Float.
- Tipos del frontend son alias de components[schemas][...] (sin definiciones a mano). EdicionExtraInput expone SOLO extraId (no idReservaExtra).

### 6. Estilo / Bulletproof / responsive
- Arrow functions en todo el codigo nuevo; sin function declarativa salvo metodos de clase. eslint limpio en api y web sobre los ficheros de la US.
- Estructura Bulletproof: api/ components/ lib/ model/ + barrel index.ts; components/ solo .tsx. Todos los ficheros < 300 lineas (mayor: 296).
- Responsive mobile-first: dialogo con scroll interno, footer flex-col -> sm:flex-row, botones full-width en <sm. QA E2E aporta evidencia en 3 viewports (390/768/1280) con 11 capturas y medicion de scrollWidth sin overflow.
- Sin any injustificado en aplicacion (los adaptadores de reenvio usan Record<string, unknown> en la frontera del puerto, documentado).

### 7. Numeracion / versionado / congelado (D1-D3)
- D1: reenvio reutiliza E2 con es_reenvio=true, sin migracion de enum.
- D2: fila nueva por version (MAX+1), vigente = MAX(version); cada envio consume AAAANNN (borrador null); reenvio sin cambios no versiona ni consume numero.
- D3: primera persistencia real de RESERVA_EXTRA ligada a la RESERVA (conjunto vivo; reemplazarLineas borra las no facturadas y re-inserta). Sin migracion.

### Correccion del bug AC-2 (congelado por extra_id) — solida
- resolverLineasExtras/emparejarExistente casan una linea existente por extra_id (identidad real del contrato/SDK/frontend) con cola FIFO por extra_id que CONSUME una persistida por propuesta; conserva precioUnitario/origen congelados y recalcula subtotal = precioCongelado x cantidad. Las propuestas sin existente que casar son NUEVAS al precio ACTUAL del catalogo. Mantiene el path por id_reserva_extra explicito.
- Test de regresion presente y explicito (describe congelado por extra_id con payload REAL del contrato, AC-2 regresion): (a) existente conserva 30.00 aunque el catalogo suba a 50.00 matcheando solo por extra_id; (b) caso mixto existente(30) + nueva(400). 49/49 unit verdes (reproducido en esta revision).

---

## Observaciones no bloqueantes

1. [Baja - conocida y aceptada] Descuento negativo -> 400 en vez de 422 DESCUENTO_INVALIDO. El Matches(IMPORTE_REGEX) del DTO rechaza el signo antes de la guarda validarDescuento (que si devuelve 422). El frontend ademas lo bloquea con Zod (descuento >= 0), asi que el 400 solo se da llamando la API directamente con cuerpo mal formado. El caso > baseImponible si devuelve 422. No bloquea; si se desea coherencia estricta, relajar el regex y delegar el signo en la guarda de negocio.

2. [Baja] Transporte real del reenvio best-effort/incompleto. ReenviarE2PresupuestoAdapter.reenviar inyecta el motor de email pero no ejerce el envio del transporte (void this.motorEmail). La fila COMUNICACION E2 (es_reenvio=true) y el AUDIT_LOG si se registran; el email real queda pendiente de cableado fino, documentado en el adaptador y a validar en integracion. No rompe ningun AC de QA.

3. [Baja] AUDIT_LOG sin datos_anteriores. Se registra datosNuevos pero no datosAnteriores (version/total previos). Suficiente para actualizar; enriquecerlo mejoraria la auditoria del historico. No bloquea.

4. [Informativo] Deudas pre-existentes ajenas a US-015: app-shell no fija sidebar en >=lg y ~15px overflow en cabecera a 768 (ya en memoria del proyecto). No introducidas por esta US.

---

## Comprobaciones ejecutadas en la revision

- jest editar-presupuesto maquina-estados-editar-presupuesto -> 2 suites, 49/49 PASS.
- eslint sobre los 7 ficheros backend nuevos/modificados -> exit 0.
- eslint sobre features/presupuestos y FichaConsulta -> exit 0 (solo warnings de boundaries).
- Regeneracion del cliente OpenAPI -> sin drift (cliente generado, no editado).
- Grep FECHA_BLOQUEADA|redis|Redlock|FOR UPDATE|distributed en presupuestos/ -> solo codigo US-014 pre-existente e invariantes/tests de no-mutacion.
- Grep any|function|@nestjs|@prisma en la capa de aplicacion -> sin violaciones.

