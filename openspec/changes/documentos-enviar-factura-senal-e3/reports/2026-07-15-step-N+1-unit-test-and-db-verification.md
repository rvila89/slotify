# Step N+1 — Unit tests + verificación de BD

**Change:** documentos-enviar-factura-senal-e3 (épico #6, rebanada 6.4b — Bloque C)
**Date:** 2026-07-15
**Branch:** feature/documentos-enviar-factura-senal-e3
**Ejecutado desde:** sesión principal (Postgres `slotify-postgres` healthy en 5432)
**Outcome:** ✅ VERDE

---

## 1. Tests dirigidos de los módulos cambiados

Comando (toolchain react-pdf ESM):

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest --runInBand \
  facturacion "comunicaciones/infrastructure/plantillas"
```

Resultado:

```
Test Suites: 32 passed, 32 total
Tests:       392 passed, 392 total
Time:        ~35 s
```

Incluye:
- **`enviar-factura-senal.use-case.spec.ts`** (nuevo, 28 casos): camino feliz
  (borrador→enviada, conserva `numero_factura`, fija `cond_part_enviadas_fecha` +
  `cond_part_firmadas=false`, COMUNICACION E3 `enviado`, AUDIT_LOG,
  `condPartAdjuntada=true`); atomicidad/rollback ante fallo de E3
  (`EmisionEnvioFallidoError`, nada se consolida); PDF señal ausente→502; estado
  `rechazada`→409; idempotencia E3 `enviado`→409 y E3 `fallido`→reintento;
  degradación de condiciones (null/throw)→E3 solo con señal + `condPartAdjuntada=false`;
  404 no encontrada / cross-tenant (RLS).
- **`catalogo-plantillas.spec.ts`**: E3 `activa=true`, render real (no placeholder),
  `variablesRequeridas` incluye `email`, `adjuntosRequeridos` incluye `senal` y NO
  `condiciones`.
- Suites de facturación preexistentes (aprobar/rechazar/liquidación/fianza/cobros,
  incl. **concurrencia y atomicidad** de US-028): sin regresión.

## 2. Verificación de BD

El nuevo caso de uso se prueba con **dobles de puertos puros** (sin Prisma, sin
react-pdf, sin conexión a BD), espejo del test de E4. La corrida de tests unitarios
**no muta** la BD de desarrollo:

- Los tests de integración del proyecto usan la BD aislada `slotify_test`
  (`.env.test`), nunca la de desarrollo (ver memoria `Tests con BD aislada slotify_test`).
- Esta rebanada **no añade** tests de integración con BD real (no era necesario:
  el use-case es lógica orquestada sobre puertos, cubierta al 100% con dobles).
- **Sin migración de BD** (los campos `RESERVA.cond_part_*` y el enum `CodigoEmail.E3`
  ya existían en `schema.prisma`).

Baseline/verificación posterior de la BD de desarrollo: **sin cambios** por la
ejecución de la suite unitaria.

## 3. Notas

- La flakiness pre-existente de las suites de render react-pdf ESM
  (`documento-*.spec` con `TypeError ... 'identifier'` al correr juntas) es ajena a
  esta rebanada y está registrada en memoria (`react-pdf ESM suite flakiness`). Las
  suites tocadas aquí (use-case con dobles, catálogo de plantillas) **no** usan
  react-pdf y pasan de forma estable.
- `pnpm lint` + `pnpm typecheck` en verde (reportado por backend-developer §4.8).

**Veredicto del paso:** ✅ Tests dirigidos en verde (392/392); BD de desarrollo
intacta.
