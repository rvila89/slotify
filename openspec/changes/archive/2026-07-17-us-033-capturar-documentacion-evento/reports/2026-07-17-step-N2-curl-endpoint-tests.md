# QA · Paso N+2 — Pruebas manuales de endpoints con curl (US-033)

Fecha: 2026-07-17 · API real en `http://localhost:3001/api` contra Postgres aislado `slotify_test_033`, adaptador de almacén `local` durable. Login gestor `info@masialencis.com` (JWT real). Reservas sembradas: `evento_en_curso` (EEC) y `reserva_confirmada` (RC).

> Nota Git Bash: `curl -F archivo=@/tmp/...` daba `HTTP 000` (curl nativo Windows no resuelve rutas MSYS). Resuelto usando ficheros en el CWD con rutas relativas. El multipart en sí funciona (una subida sin fichero devolvió correctamente 422 ARCHIVO_REQUERIDO).

| # | Escenario | Esperado | Obtenido |
|---|---|---|---|
| 1 | POST upload `dni_anverso` (JPEG) en EEC | 201 + documento + checklist (`dni_anverso` completado) | ✅ 201; url `…/documentos-evento/{tenant}/{reserva}/dni_anverso/{uuid}.jpg`, tamanoBytes=30 |
| 2 | GET checklist | 200; anverso true, resto false | ✅ 200 |
| 3 | RE-UPLOAD `dni_anverso` (no idempotente) | 201, nuevo `idDocumento` | ✅ 201; `idDocumento` distinto; checklist referencia el **más reciente** |
| 4 | POST `clausula_responsabilidad` (PDF) | 201 | ✅ 201 |
| 5 | POST en RC (`reserva_confirmada`) | 422 `ESTADO_NO_PERMITE_DOCUMENTACION` | ✅ 422; msg "La documentación del evento solo puede capturarse mientras el evento está en curso" |
| 6 | POST formato `text/plain` | 422 `FORMATO_NO_PERMITIDO` | ✅ 422; msg "Formato no admitido. Por favor, usa JPEG, PNG o PDF." |
| 7 | POST sin fichero | 422 `ARCHIVO_REQUERIDO` | ✅ 422; msg "Es obligatorio adjuntar un archivo" |
| 8 | POST `tipo=presupuesto` (no permitido) | 422 `TIPO_DOCUMENTO_NO_PERMITIDO` | ✅ 422 |
| 9 | POST reserva inexistente | 404 `RESERVA_NO_ENCONTRADA` | ✅ 404 |
| 10 | GET checklist sin token | 401 | ✅ 401 |
| FIN | GET checklist final | anverso+clausula true, reverso false | ✅ 200 (referencia anverso = documento más reciente) |

Todos los códigos y mensajes coinciden con el contrato congelado (`docs/api-spec.yml`) y con los literales de la spec-delta. Estado BD posterior verificado en el paso N+1 (3 filas DOCUMENTO, 3 AUDIT_LOG, 0 filas en los rechazos).

**Veredicto paso N+2: OK.**
