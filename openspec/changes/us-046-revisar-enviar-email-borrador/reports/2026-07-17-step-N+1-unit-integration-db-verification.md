# QA — Paso N+1: Unit + Integración (BD real) + verificación de estado BD (US-046)

Fecha: 2026-07-17 · Ejecutado por: sesión principal (con Docker/Postgres) · Rama: `feature/us-046-revisar-enviar-email-borrador`

> Los tests unit los puede correr un subagente; **la integración (BD real), la migración y
> la verificación de estado de BD las ejecuta la sesión principal** (los subagentes QA
> corren sin Postgres). Este informe recoge esa ejecución real.

## 1. Unit — módulo `comunicaciones`

Comando: `NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --runInBand --testPathPatterns="src/comunicaciones" --testPathIgnorePatterns="integration"`

Resultado: **16 suites / 128 tests — PASS**. Incluye:
- Use-cases US-046: `enviar-borrador`, `descartar-borrador`, `crear-email-manual`.
- Validador de dominio `esemailvalido`.
- Contrato del puerto `listarPorReserva` (proyección `ComunicacionListItem`).
- Regresión de errores compartidos `comunicacion-errors.spec.ts` (ver informe curl §bug 3).
- Suites de US-045 (motor `despachar-email`, repos, catálogo) — **sin regresión**.

`tsc --noEmit` (toda la api): **limpio**. `eslint src/comunicaciones/**/*.ts`: **0 problemas**.

## 2. Migración de esquema (D-5, Opción C)

Migración `20260717120000_us046_comunicacion_manual_indice_parcial` aplicada con
`prisma migrate deploy` a **ambas** BD (`slotify_test_046` y `slotify_dev`).

Verificación del predicado real del índice (psql):

```
CREATE UNIQUE INDEX uq_comunicacion_reserva_codigo ON public.comunicacion
  USING btree (reserva_id, codigo_email)
  WHERE ((reserva_id IS NOT NULL) AND (es_reenvio = false) AND (codigo_email <> 'manual'::"CodigoEmail"))
```

Correcto: se añade `AND codigo_email <> 'manual'` (aditivo); E1–E8 conservan su idempotencia.

## 3. Integración (BD real) — invariante del índice + listado + RLS

Comando: `NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --runInBand --testPathPatterns="comunicacion-manual-indice-parcial"`

Resultado: **1 suite / 5 tests — PASS** contra el Postgres del docker-compose:
1. Dos `manual` con `reserva_id` no nulo y `es_reenvio=false` **coexisten sin P2002** (invariante D-5).
2. El `manual` persiste `es_reenvio=false` (semántica honesta).
3. **Regresión US-045**: un segundo `E1` no-reenvío en la misma reserva **sí** colisiona (P2002).
4. `listarPorReserva` devuelve la proyección de la ficha con `clienteId` y `cuerpo` reales, `accionable` derivado, ordenado por `fechaCreacion desc`.
5. **Aislamiento cross-tenant**: `listarPorReserva` con otro `tenant_id` devuelve 0 filas.

> Nota: el test 5 obligó a un fix — ver informe curl §bug 2 (fuga cross-tenant en el listado
> porque el rol de BD `user` es superusuario `BYPASSRLS`; se añadió filtro explícito por
> `tenant_id`, defensa en profundidad).

## 4. Verificación de estado de BD (AUDIT_LOG)

Tras el escenario curl, las entradas en `audit_log` (entidad `COMUNICACION`) son coherentes:
- Envío del borrador → `accion='actualizar'`, `datos_nuevos.motivo='envio_manual_borrador'`, `estado='enviado'`.
- **Descarte** → `accion='actualizar'`, `datos_nuevos.causa='descartado por gestor'`, `estado='fallido'` (cumple el requirement del spec-delta).
- Email manual → `accion='crear'`, `datos_nuevos.motivo='email_manual'`, `estado='enviado'`.

Veredicto del paso: **PASS**.
