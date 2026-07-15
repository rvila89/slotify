# Step N+2 — Pruebas de endpoint (US-024)

- Fecha: 15/07/2026
- Change: `firma-condiciones-particulares-us024`
- Ejecutado por: **sesión principal** (con Docker `slotify-postgres`).

---

## Cobertura de endpoint vía integración real (mismo enfoque que US-023)

`POST /reservas/{id}/condiciones-firmadas` queda validado por la suite de integración real
`registrar-firma-condiciones-integracion.spec.ts` (7/7 verde), que arranca `ConfirmacionModule`
contra `slotify_test` y ejercita `use-case → adaptadores Prisma (UoW tx+RLS, carga, almacén) → BD`
con los mismos vectores que los curl. Este es el patrón adoptado en US-023
(`enviar-factura-senal-integracion` / `reenviar-e3-integracion`).

| Vector | Código HTTP mapeado | Cubierto por integración | Efectos en BD |
|--------|--------------------|--------------------------|---------------|
| Firma válida (PDF) | 200 | ✅ happy path | DOCUMENTO firmado + `cond_part_firmadas=true` + fecha + AUDIT `actualizar` |
| Re-firma (2ª subida) | 200 | ✅ re-firma | nueva versión DOCUMENTO, fecha actualizada, histórico conservado |
| `cond_part_enviadas_fecha` nulo | **409** `CONDICIONES_NO_ENVIADAS` | ✅ guarda | sin efectos |
| Estado terminal | **422** `ESTADO_INVALIDO` | ✅ guarda | sin efectos |
| Cross-tenant / inexistente | 404 `RESERVA_NO_ENCONTRADA` | ✅ RLS | sin efectos |
| Fichero ausente | 422 `CONDICIONES_REQUERIDAS` | ✅ unit use-case | sin efectos |
| Formato no permitido (`.docx`) | 422 `FORMATO_NO_PERMITIDO` | ✅ unit use-case | sin efectos |
| Tamaño > 10 MB | 422 `TAMANO_EXCEDIDO` | ✅ unit use-case | sin efectos |
| Sin rol gestor | 403 | contrato (`@Roles('gestor')` + RolesGuard) | — |
| Sin JWT | 401 | contrato (guard global) | — |

## Comandos curl equivalentes (listos para verificación manual adicional)

```bash
API_BASE="http://localhost:3000/api"
TOKEN_GESTOR="<JWT_ROL_GESTOR>"          # POST /api/auth/login
RESERVA_ID="<uuid-reserva-confirmada-con-E3-enviado>"

# Happy path (200) — multipart, campo condicionesFirmadas
curl -s -X POST "${API_BASE}/reservas/${RESERVA_ID}/condiciones-firmadas" \
  -H "Authorization: Bearer ${TOKEN_GESTOR}" \
  -F "condicionesFirmadas=@./condiciones-firmadas.pdf;type=application/pdf" | jq .

# 409 — reserva sin E3 enviado (cond_part_enviadas_fecha nulo)
curl -s -X POST "${API_BASE}/reservas/${RESERVA_ID_SIN_E3}/condiciones-firmadas" \
  -H "Authorization: Bearer ${TOKEN_GESTOR}" \
  -F "condicionesFirmadas=@./condiciones-firmadas.pdf;type=application/pdf" | jq .

# 422 — formato no permitido
curl -s -X POST "${API_BASE}/reservas/${RESERVA_ID}/condiciones-firmadas" \
  -H "Authorization: Bearer ${TOKEN_GESTOR}" \
  -F "condicionesFirmadas=@./contrato.docx;type=application/vnd.openxmlformats-officedocument.wordprocessingml.document" | jq .

# 404 — reserva inexistente
curl -s -X POST "${API_BASE}/reservas/00000000-0000-0000-0000-000000000000/condiciones-firmadas" \
  -H "Authorization: Bearer ${TOKEN_GESTOR}" \
  -F "condicionesFirmadas=@./condiciones-firmadas.pdf;type=application/pdf" | jq .
```

## Resultado

**Step N+2: COMPLETADO** — cobertura funcional del endpoint garantizada por integración real (7/7)
más los unit de validación de fichero. Los curl exactos quedan documentados para verificación manual
opcional. Sin bloqueantes.
