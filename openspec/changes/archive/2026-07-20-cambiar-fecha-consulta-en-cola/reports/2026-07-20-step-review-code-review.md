# Informe de code-review — change `cambiar-fecha-consulta-en-cola`

- Fecha: 2026-07-20
- Rama: `feature/cambiar-fecha-consulta-en-cola` (working tree sin commitear)
- Alcance: habilitar origen `2d` (cola de espera) en `POST /reservas/{id}/cambiar-fecha`
- Revisión de SOLO LECTURA contra `review-checklist` + `architecture-guardrails`.

## Veredicto: APTO

Sin hallazgos Bloqueantes ni Altos. Se listan hallazgos Bajos (cosméticos/doc) que no
impiden el merge.

---

## Resumen por regla (guardrails Slotify)

### Bloqueo atómico de fecha — OK
- La serialización vive SOLO en PostgreSQL: `SELECT … FOR UPDATE` sobre la RESERVA
  (`FOR UPDATE OF r`), sobre `FECHA_BLOQUEADA(tenant, F2)` (`FOR UPDATE OF fb`) y sobre la
  cola hermana; exclusión por `UNIQUE(tenant_id, fecha)` que emite `P2002` → 409 terminal
  con rollback total.
- No hay Redis/Redlock/lock distribuido ni en memoria (grep limpio).
- La rama `2d` reutiliza la primitiva atómica existente: `fechaBloqueada.bloquear()` hace
  `updateMany` en sitio y, cuando la reserva en cola NO tiene fila propia (`count === 0`),
  cae en `bloquearEnTx` con `resolverPlanBloqueo` (INSERT del bloqueo blando nuevo con TTL).
  El TTL de `moverFueraDeCola` también sale de `resolverPlanBloqueo` (coherente con
  `bloquear`).
- Todo ocurre en una única `$transaction`; `fijarTenant(tx, tenantId)` es la primera
  operación (SET LOCAL app.tenant_id) → RLS activo antes de leer/mutar.

### Hexagonal — OK
- `domain/salida-de-cola.ts` es dominio PURO: sin `@nestjs/*`, sin `@prisma/*`, sin
  `infrastructure/`; solo importa el tipo `SubEstadoConsulta` de `maquina-estados`. Función
  pura, determinista, no muta la entrada.
- `maquina-estados.ts` añade la guarda `esOrigenCambiarFechaEnCola` + tabla
  `MAPA_CAMBIAR_FECHA_EN_COLA` + `resolverCambioFechaEnCola`, todo puro.
- El use-case (application) orquesta puertos; el adaptador Prisma implementa los puertos.
  Frontera respetada.

### Máquina de estados declarativa — OK
- Guarda `2d` modelada como estructura de datos (`ORIGENES_CAMBIAR_FECHA_EN_COLA`) y
  transición como tabla (`MAPA_CAMBIAR_FECHA_EN_COLA: {consulta,2d} → {consulta,2b}`), no
  `if/else` dispersos.
- La guarda `2d` está SEPARADA y DISJUNTA de `esOrigenValidoParaCambiarFecha` (2b/2c/2v):
  ningún par satisface ambas. Origen inválido → `CambiarFechaValidacionError` (422).
- La reordenación de cola valida contigüidad (1..N) y, ante anomalía, no reordena en
  silencio (marca `anomalia`).

### Multi-tenancy / RLS — OK
- Todas las queries filtran por `tenant_id` y se ejecutan tras `fijarTenant`.
- El `tenant_id` viaja en el comando desde el JWT (no del path/body); el controlador no se
  modificó. Cross-tenant → RESERVA no encontrada (404 vía `ReservaNoEncontradaError`).

### Contrato ↔ backend ↔ SDK — OK
- `docs/api-spec.yml` cambia SOLO la documentación (summary/description/responses):
  request/response conservan el mismo esquema en ambas ramas.
- El 409 de la rama `2d` respeta el shape terminal (solo `motivo`, sin `colaDisponible`):
  verificado en el use-case, en el controlador (`cambiar-fecha.controller.ts`, no
  modificado) y en el test unit (`el_error_es_terminal_shape_solo_motivo_sin_colaDisponible`).
- Cliente HTTP generado NO editado a mano: el frontend consume `apiClient`/`components` y la
  invalidación de queries; no se tocó `@/api-client`.

### Frontend — OK
- `FechaConsultaSeccion.tsx` (solo `.tsx` en `components/`): añade `2d` a
  `SUB_ESTADOS_CAMBIAR_FECHA`; responsive mobile-first (`w-full sm:w-auto`, `rounded-full`),
  sin anchos px fijos que rompan en móvil.
- `useCambiarFecha.ts` importa `comunicacionesReservaQueryKey` por el barrel
  `@/features/comunicaciones` (respeta boundaries) e invalida la query de comunicaciones para
  que el borrador E1 aparezca sin recargar.
- Evidencia responsive en 3 viewports (390/768/1280) aportada en el report E2E
  (`2026-07-20-step-N+3-e2e-playwright.md`).

### Tests primero (TDD) — OK
- Dominio: `salida-de-cola-cambiar-fecha.spec.ts`,
  `maquina-estados-cambiar-fecha-en-cola.spec.ts`,
  `maquina-estados-transicion-cambiar-fecha-en-cola.spec.ts`.
- Aplicación: `cambiar-fecha-en-cola.use-case.spec.ts` (efectos completos + 409 + 422 +
  no-promoción + no-toca-bloqueante).
- Concurrencia REAL contra Postgres: `cambiar-fecha-en-cola-concurrencia.spec.ts`
  (`Promise.allSettled`, exclusión por `UNIQUE`, sin locks distribuidos).
- El bug de QA (leer la cola hermana ANTES de `moverFueraDeCola`) está GUARDADO: el fake del
  unit test es CON ESTADO (`salienteFueraDeCola`) y `leerColaHermana` filtra la saliente tras
  mover; si se regresara al orden erróneo, la cola quedaría no contigua → anomalía → sin
  reordenación → el test `debe_reordenar_la_cola_vieja_cerrando_el_hueco_contiguo_desde_1`
  fallaría. El código lee ANTES (use-case paso 2, comentario explícito). Correcto.
- QA: 8 suites / 94 tests VERDE en aislamiento; concurrencia VERDE; curl 200→2b / 409 sin
  `colaDisponible` / 422; E2E PASS. Las 9 suites rojas globales son PRE-EXISTENTES y ajenas
  (react-pdf ESM, facturación, `finalizar-evento-integracion`); el diff no toca esos ficheros.

### Convenciones — OK
- Arrow functions en dominio/use-case/frontend; sin `function` declarativo (métodos de clase
  Nest exentos). Sin `any` en el dominio nuevo. Nombres en español; errores en español.
- Importes no aplican a este change (no toca dinero); no se introduce `Float`.

### Regresión 2b/2c/2v — OK
- La bifurcación por origen antepone la rama `2d`; si no es `2d`, sigue la guarda y el flujo
  existente sin cambios. El `SELECT` ampliado usa `JOIN cliente` con campos opcionales en la
  proyección y `FOR UPDATE OF r` (serializa solo la fila de reserva), sin alterar el
  comportamiento 2b/2c/2v. Test de gating del frontend cubre la regresión.

---

## Hallazgos

### Bloqueantes
- Ninguno.

### Altos
- Ninguno.

### Medios
- Ninguno.

### Bajos
1. [cosmético] `application/cambiar-fecha.use-case.ts` — dos comentarios de paso numerados
   como "4." (el borrador E1 y la reordenación); renumerar a 4/5/6 para claridad. No afecta
   comportamiento.
2. [doc] `docs/api-spec.yml` describe `AUDIT_LOG` con `accion='actualizar'/'transicion'`,
   pero el use-case registra siempre `accion:'actualizar'` en la rama `2d`. Alinear la
   descripción del contrato (o el valor) para evitar ambigüedad documental. Es solo doc.
3. [defensa] `leerColaHermana` mapea `posicion_cola ?? 0` y `consulta_bloqueante_id ?? ''`
   por defensa de tipos; en la práctica una fila `s2d` siempre los tiene no nulos y
   `planificarSalidaDeCola` detectaría una cola incoherente como anomalía. Sin riesgo;
   solo se anota.

## Fuentes
- `.claude/skills/review-checklist/SKILL.md`, `.claude/skills/architecture-guardrails/SKILL.md`
- `CLAUDE.md` (Regla crítica, Multi-tenancy, Máquina de estados, convenciones)
- Diff working tree + ficheros untracked del change.

Veredicto: APTO
