# QA — Paso N+2: pruebas curl de endpoints (US-046)

Fecha: 2026-07-17 · Ejecutado por: sesión principal · API dev en `http://localhost:3002/api` (transporte email en modo **fake**) · Gestor `info@masialencis.com`.

Escenario sembrado (tenant piloto): reserva **R1** (cliente con email válido) con borradores
`B1(E1)` a enviar, `B2(E2)` a descartar, `B3(E3)` con `destinatario_email` vacío; reserva
**R2** con cliente **sin email**. `B1.fecha_creacion` sembrada a `2026-07-16` para verificar
que la respuesta no la fabrica.

## Resultados (todos conformes al contrato y a los AC)

| # | Acción | Esperado | Obtenido |
|---|--------|----------|----------|
| 1 | `GET /reservas/R1/comunicaciones` | 200, lista con `cuerpo`/`clienteId` reales, `accionable` según estado | **200** ✓ (B1 con `cuerpo` real, `clienteId` real, `accionable=true`) |
| 2 | `POST .../B1/enviar` con `{cuerpo editado}` | 200 `enviado`, `fecha_envio` no nula, `cuerpo` = editado, `fecha_creacion`=2026-07-16 | **200** ✓ (`cuerpo` editado persistido; `fecha_creacion` real, NO fabricada) |
| 3 | `POST .../B1/enviar` de nuevo | 409 `ESTADO_NO_BORRADOR` | **409** ✓ |
| 4 | `POST .../B3/enviar` (dest. vacío) | 422 `DESTINATARIO_INVALIDO`, B3 sigue `borrador` | **422** ✓ (GET posterior: B3 sigue `borrador`) |
| 5 | `POST .../B2/descartar` | 200 `fallido` sin `fecha_envio` | **200** ✓ |
| 6 | `POST .../B2/descartar` de nuevo | 409 `ESTADO_NO_BORRADOR` | **409** ✓ |
| 7 | `POST .../manual` (R1) | 201 `manual`/`enviado`, `esReenvio=false` | **201** ✓ |
| 8 | `POST .../manual` (R1) 2º | 201 sin colisión de unicidad (invariante D-5) | **201** ✓ |
| 9 | `POST .../manual` (R2, cliente sin email) | 422 `DESTINATARIO_INVALIDO` | **422** ✓ (tras fix; ver bug 3) |
| 10 | `GET` final R1 | E1 `enviado`, E2 `fallido`, N×`manual` `enviado` | **200** ✓ |

## Bugs detectados por la QA real (no por unit) y corregidos

**Bug 1 — cuerpo vacío en la revisión (funcional).** El listado devolvía `cuerpo: null` y el
diálogo del frontend precarga el formulario con `borrador.cuerpo` → el gestor abría un borrador
y veía el cuerpo VACÍO (rompe el happy path "revisa el contenido y confirma sin editar"). Además
`clienteId: ''` y `fecha_creacion` fabricada (`new Date()`) en las respuestas de mutación.
Corregido: proyección `ComunicacionListItem` y `ComunicacionRegistrada` enriquecidas con
`clienteId`/`cuerpo`/`fechaCreacion`/`esReenvio` reales (backend-only; el contrato ya los exigía).

**Bug 2 — fuga cross-tenant en el listado (seguridad).** `listarPorReserva` filtraba solo por
`reservaId` y confiaba en RLS; pero el rol de BD `user` es superusuario `BYPASSRLS`, de modo que
el listado devolvía filas de otra tenant. Corregido: filtro EXPLÍCITO por `tenant_id` en el
`WHERE` (defensa en profundidad, igual que los adaptadores de carga de enviar/manual). Verificado
por el test de integración 5.

**Bug 3 — email manual devolvía 500 en vez de 422/502.** `crear-email-manual.use-case` definía
sus propias clases `DestinatarioInvalidoError`/`ProveedorEmailError`, distintas de las que el
controller comprueba por `instanceof` → el 422/502 del endpoint `manual` caía a un 500 genérico.
Corregido: errores extraídos a un módulo compartido `comunicacion-errors.ts` (misma clase en los
tres use-cases) + test de regresión `comunicacion-errors.spec.ts`. Re-verificado por curl (test 9:
500 → 422).

Veredicto del paso: **PASS** (los tres bugs quedaron corregidos y re-verificados).
