# Re-verificación QA — Fix hallazgo Alta: FichaYaCerradaError idempotente (2026-07-04)

## Contexto

Re-QA focalizado tras subsanar el hallazgo Alta del code-review de US-026:
el error `FichaYaCerradaError` (cierre manual US-025 pierde la carrera contra el cron A10
bajo lock) ya no propaga a HTTP 500. El caso de uso `CerrarFichaOperativaUseCase` lo
intercepta y resuelve **idempotente 200** devolviendo la ficha cerrada actual, sin re-mutar
ni duplicar auditoría.

Ficheros modificados en el fix:
- `apps/api/src/ficha-evento/domain/ficha-operativa.ports.ts` — `FichaYaCerradaError` promovido a dominio
- `apps/api/src/ficha-evento/infrastructure/cierre-ficha-uow.prisma.adapter.ts` — lanza `FichaYaCerradaError` bajo lock
- `apps/api/src/ficha-evento/application/cerrar-ficha-operativa.use-case.ts` — captura el error, resuelve idempotente
- `apps/api/src/ficha-evento/__tests__/cerrar-ficha-operativa-interleaving.spec.ts` — NUEVO test de interleaving real

---

## Step N+1 (re-verificacion) — Unit tests + estado BD

### Comandos ejecutados

```
# BD: slotify_test (.env.test)

# Suites US-026 (5 originales)
npx jest --runInBand "cierre-automatico-a10.spec.ts" --no-coverage
npx jest --runInBand "cerrar-fichas-vencidas.use-case.spec.ts" --no-coverage
npx jest --runInBand "cerrar-fichas-vencidas-integracion.spec.ts" --no-coverage
npx jest --runInBand "cerrar-fichas-vencidas-concurrencia.spec.ts" --no-coverage
npx jest --runInBand "barrido-fichas.controller.spec.ts" --no-coverage

# Suite NUEVO test de interleaving (fix hallazgo Alta)
npx jest --runInBand "cerrar-ficha-operativa-interleaving.spec.ts" --no-coverage

# Suites US-025 (cierre manual — regresión)
npx jest --runInBand "cerrar-ficha-operativa.use-case.spec.ts" --no-coverage

# Regresion completa ficha-evento (11 suites)
npx jest --runInBand --testPathPatterns="ficha-evento" --no-coverage

# Suite global
npx jest --runInBand --no-coverage

# Arquitectura
npx depcruise src --config .dependency-cruiser.cjs
```

### Resultados

| Suite | Tests | Resultado |
|-------|-------|-----------|
| cierre-automatico-a10.spec.ts | 7/7 | PASS |
| cerrar-fichas-vencidas.use-case.spec.ts | 8/8 | PASS |
| cerrar-fichas-vencidas-integracion.spec.ts | 13/13 | PASS |
| cerrar-fichas-vencidas-concurrencia.spec.ts | 2/2 | PASS |
| barrido-fichas.controller.spec.ts | 4/4 | PASS |
| **cerrar-ficha-operativa-interleaving.spec.ts (NUEVO)** | **2/2** | **PASS** |
| cerrar-ficha-operativa.use-case.spec.ts (US-025 regresion) | 11/11 | PASS |
| **ficha-evento completa (11 suites)** | **103/103** | **PASS** |
| **Suite global** | **1213/1214** | **1 fallo pre-existente** |
| depcruise arch | 373 modules / 1317 deps | PASS (0 violations) |

#### Nuevo test de interleaving (hallazgo Alta)

`cerrar-ficha-operativa-interleaving.spec.ts` — 2 tests:
- `debe_resolver_idempotente_devolviendo_la_ficha_cerrada_sin_lanzar_ni_500`: PASS
- `no_debe_lanzar_FichaYaCerradaError_al_borde_del_caso_de_uso`: PASS

#### Fallo pre-existente en suite global (AJENO a US-026)

```
FAIL src/reservas/__tests__/alta-consulta-con-fecha-concurrencia.spec.ts
  alta-consulta-con-fecha — D5/D6:
    debe_producir_un_unico_bloqueo_y_posiciones_de_cola_unicas...
    PrismaClientKnownRequestError: Raw query failed. Code: 40P01
    Message: ERROR: deadlock detected (ShareLock deadlock)
```

Identificado en memoria del proyecto como **US-004 flaky pre-existente** (40P01 deadlock
en test de concurrencia de reservas). Completamente ajeno al diff de US-026 (no toca
ningún archivo de `src/reservas/`). Deuda técnica pendiente de estabilizar por separado.

### Comparacion BD pre/post (slotify_test)

| tabla | pre | post | delta | restaurado |
|-------|-----|------|-------|------------|
| reserva | 1 | 1 | 0 | n/a |
| ficha_operativa | 0 | 0 | 0 | n/a |
| cliente | 4 | 4 | 0 | n/a |
| audit_log | 1736 | 1835 | +99 | n/a (comportamiento esperado) |

Reserva pre-existente (`e2e00001-...`, estado=consulta, preEventoStatus=pendiente) intacta.
El delta en audit_log (+99) corresponde a los tests de integración que crean y limpian sus
datos de negocio pero retienen las entradas de auditoría (comportamiento correcto; el audit
trail es inmutable por diseño). No hay mutaciones de negocio no deseadas.

### Restauracion BD (slotify_test)

No requiere restauracion. Los tests limpian sus datos de negocio (reservas, fichas, clientes)
via `afterAll/beforeEach`. El audit_log crece fisiologicamente durante los tests (esperado).

---

## Step N+2 (re-verificacion) — Curl focalizado en el fix idempotente

### Entorno

- Backend: NestJS en `http://localhost:3000` (slotify_dev)
- BD: slotify_dev (`postgresql://user:password@localhost:5432/slotify_dev`)
- Usuario: `info@masialencis.com` / gestor / tenant `00000000-0000-0000-0000-000000000001`

### Baseline slotify_dev pre-curl

| tabla | pre |
|-------|-----|
| reserva (tenant) | 1 |
| ficha_operativa | 0 |
| cliente (tenant) | 1 |
| audit_log (entidad reserva test) | 0 |

### Datos de test sembrados

**Escenario A — Idempotente (ficha YA cerrada por A10):**
```
reservaId: 6b46a143-dede-4920-b05a-ca0d0ff20a49
fichaId:   c4d1bc46-da09-4f5c-8c27-acf65d21ba29
estado:    reserva_confirmada
preEventoStatus: cerrado  (A10 ya ganó la carrera)
fichaCerrada: true
fechaCierre: 2026-08-14T22:00:00.000Z  (la del cron A10)
auditLog previa: 1 × transicion (causa: A10, usuarioId: null)
```

**Escenario B — Happy path (ficha en_curso, cierre normal):**
```
reservaId: ae0f5c1b-3104-4050-aacd-1cd653f438d3
fichaId:   c59ed9f8-fe18-49e2-aef1-755a07f24879
estado:    reserva_confirmada
preEventoStatus: en_curso
fichaCerrada: false
```

### Comandos y respuestas

#### Verificacion GET de la ficha ya cerrada

```bash
curl -s -X GET \
  "http://localhost:3000/api/reservas/6b46a143-dede-4920-b05a-ca0d0ff20a49/ficha-operativa" \
  -H "Authorization: Bearer <JWT>"
```

Respuesta (200):
```json
{
  "idFicha": "c4d1bc46-da09-4f5c-8c27-acf65d21ba29",
  "reservaId": "6b46a143-dede-4920-b05a-ca0d0ff20a49",
  "fichaCerrada": true,
  "fechaCierre": "2026-08-14T22:00:00.000Z",
  "preEventoStatus": "cerrado"
}
```

#### TEST PRINCIPAL — POST cierre manual sobre ficha YA cerrada (escenario C-2)

```bash
curl -s -o response.txt -w "%{http_code}" \
  -X POST \
  "http://localhost:3000/api/reservas/6b46a143-dede-4920-b05a-ca0d0ff20a49/ficha-operativa/cerrar" \
  -H "Authorization: Bearer <JWT>"
```

**HTTP STATUS: 200** (esperado: 200; antes del fix: 500)

Respuesta body:
```json
{
  "idFicha": "c4d1bc46-da09-4f5c-8c27-acf65d21ba29",
  "reservaId": "6b46a143-dede-4920-b05a-ca0d0ff20a49",
  "numInvitadosConfirmado": null,
  "menuSeleccionado": null,
  "timingDetallado": null,
  "contactoEventoNombre": null,
  "contactoEventoTelefono": null,
  "notasOperativas": null,
  "briefingEquipo": null,
  "fichaCerrada": true,
  "fechaCierre": "2026-08-14T22:00:00.000Z",
  "preEventoStatus": "cerrado",
  "avisosCamposVacios": [
    "numInvitadosConfirmado", "menuSeleccionado", "timingDetallado",
    "contactoEventoNombre", "contactoEventoTelefono", "notasOperativas", "briefingEquipo"
  ]
}
```

Verificaciones post-curl (escenario A):

| verificacion | esperado | observado | resultado |
|---|---|---|---|
| HTTP status | 200 | 200 | PASS |
| fichaCerrada | true | true | PASS |
| preEventoStatus | cerrado | cerrado | PASS |
| fechaCierre (sin cambio) | 2026-08-14T22:00:00.000Z | 2026-08-14T22:00:00.000Z | PASS |
| audit_log count para reserva | 1 (solo A10) | 1 | PASS (sin duplicacion) |
| audit_log id | 1b8d168a-55ad-48c5-97e3-4cd541fe3524 | mismo | PASS (no se crea nueva) |

#### Happy path — POST cierre manual sobre ficha en_curso (escenario B)

```bash
curl -s -o happy.txt -w "%{http_code}" \
  -X POST \
  "http://localhost:3000/api/reservas/ae0f5c1b-3104-4050-aacd-1cd653f438d3/ficha-operativa/cerrar" \
  -H "Authorization: Bearer <JWT>"
```

**HTTP STATUS: 200**

Verificaciones post-curl (escenario B):

| verificacion | esperado | observado | resultado |
|---|---|---|---|
| HTTP status | 200 | 200 | PASS |
| fichaCerrada | true | true | PASS |
| preEventoStatus | cerrado | cerrado | PASS |
| fechaCierre | poblada (now) | 2026-07-04T20:46:35.313Z | PASS |
| audit_log count para reserva | 1 | 1 | PASS (1 sola transicion) |
| datosNuevos | preEventoStatus=cerrado, fichaCerrada=true | idem | PASS |

### Comparacion BD slotify_dev pre/post curl

| tabla | pre | post-curl | delta | restaurado |
|-------|-----|-----------|-------|------------|
| reserva (tenant) | 1 | 3 (+2 test) | +2 | Si (borradas) |
| ficha_operativa | 0 | 2 (+2 test) | +2 | Si (borradas) |
| cliente (tenant) | 1 | 3 (+2 test) | +2 | Si (borradas) |
| audit_log (entidades test) | 0 | 2 | +2 | Si (borradas) |

### Restauracion BD (slotify_dev)

```
Deleted audit logs: 2  (entidad=reserva, ids de test)
Deleted fichas: 2
Deleted reservas: 2
Deleted clientes: 2
FINAL STATE: { reservas: 1, fichas: 0, clientes: 1 }  ← igual al baseline
```

BD restaurada al baseline exacto.

---

## Outcome

| ambito | resultado |
|--------|-----------|
| Suites US-026 (5 originales) | 34/34 PASS |
| Suite NUEVO interleaving C-2 | 2/2 PASS |
| Suites US-025 (regresion manual) | 11/11 PASS |
| Regresion ficha-evento (11 suites) | 103/103 PASS |
| Suite global | 1213/1214 (1 fallo US-004 pre-existente, AJENO) |
| depcruise arch | 0 violations PASS |
| curl POST cerrar sobre ficha YA cerrada | HTTP 200 idempotente (no 500) PASS |
| No duplicacion audit tras idempotente | audit count=1 (sin nueva entrada) PASS |
| fechaCierre no mutada | 2026-08-14T22:00:00.000Z invariante PASS |
| Happy path cierre normal | HTTP 200, 1 audit, ficha cerrada PASS |
| BD slotify_test restaurada | Sin mutaciones de negocio PASS |
| BD slotify_dev restaurada | Baseline exacto restaurado PASS |

**Veredicto: PASS**

El hallazgo Alta queda cerrado: `FichaYaCerradaError` bajo lock se resuelve idempotente 200
en el caso de uso, sin 500, sin re-mutacion de estado ni duplicacion de auditoría. El nuevo
test de integración real `cerrar-ficha-operativa-interleaving.spec.ts` ejercita y verifica
el camino en verde. La regresion de ficha-evento (103/103) confirma que US-025 no se ve
afectado. El unico fallo de la suite global es el flaky pre-existente US-004, documentado
como deuda tecnica ajena a este change.
