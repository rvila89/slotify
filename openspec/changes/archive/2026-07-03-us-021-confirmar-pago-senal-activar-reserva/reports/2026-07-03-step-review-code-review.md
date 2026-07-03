# Informe de code-review - US-021 "Confirmar pago de senal y activar reserva confirmada"

- Fecha: 2026-07-03
- Change: us-021-confirmar-pago-senal-activar-reserva
- Branch: feature/us-021-confirmar-pago-senal-activar-reserva (base master)
- Revisor: code-reviewer (solo lectura, gate duro)
- Alcance: git diff + working tree. Backend apps/api/src/confirmacion/** + guarda en
  reservas/domain/maquina-estados.ts; frontend apps/web/src/features/confirmacion/** +
  cableado en FichaConsulta; contrato docs/api-spec.yml + SDK apps/web/src/api-client/schema.d.ts;
  hook scripts/hooks/validate-openapi.py; tests en confirmacion/__tests__/ y
  reservas/__tests__/maquina-estados-confirmar-senal.spec.ts.

## Resumen de verificacion

- Backend tests (confirmacion + maquina de estados): 68/68 en verde (incluye concurrencia
  real contra Postgres slotify_test: 1 gana / 1 rechaza).
- pnpm lint en apps/api: OK (arrow functions, func-style, sin errores).
- pnpm lint en apps/web (--max-warnings 0): OK (solo notas de deprecacion del plugin
  boundaries, no errores; barrels/boundaries/max-lines respetados).
- SDK generado (schema.d.ts) coincide 1:1 con docs/api-spec.yml (regenerado, no editado a mano).

## Checklist de guardrails

1. Bloqueo atomico - CUMPLE. El upgrade blando->firme reutiliza la primitiva de US-040
   (FechaBloqueadaPrismaAdapter.bloquearEnTx con plan.modo=upgrade) dentro de la MISMA tx:
   SELECT ... FOR UPDATE + UPDATE de la fila existente conservando reserva_id (aplicarUpgrade,
   nunca delete+insert), firme + ttl NULL, respaldado por UNIQUE(tenant_id, fecha). Sin
   Redis/Redlock. Todo en una transaccion all-or-nothing. Verificado por integracion 3.4
   (una sola fila, firme, ttl null) y rollback 3.3.
2. Hexagonal - CUMPLE. El use-case no importa @nestjs/*, @prisma/* ni infraestructura; solo
   puertos y la guarda pura de maquina-estados.ts. Adaptadores en infrastructure/, tokens de
   wiring fuera del dominio. El hook no-infra-in-domain no se dispara.
3. Multi-tenancy / RLS - CUMPLE. fijarTenant(tx, tenantId) es la primera operacion de la UoW
   y de cada adaptador de lectura; tenantId y usuarioId derivan del JWT (@CurrentUser), nunca
   del path/body. Filtro tenant_id en todas las queries. Cross-tenant -> null -> 404 verificado.
4. Maquina de estados - CUMPLE. Nueva guarda esOrigenValidoParaConfirmarSenal como tabla
   declarativa ORIGENES_TRANSICION_CONFIRMAR_SENAL ({pre_reserva, null}); sin if/else dispersos.
   Se re-evalua bajo el lock dentro de la tx (doble clic -> RESERVA_YA_CONFIRMADA). Invalido -> 422.
5. Importes - CUMPLE. congelarImportes en centimos enteros: senal = round(total x pct/100, 2),
   liquidacion = total - senal (complemento por resta). pct_senal desde TENANT_SETTINGS (no
   hardcodeado). Prisma.Decimal; columnas Decimal(10,2) / pct_senal Decimal(4,2). Verificado:
   3000 al 40 por ciento -> 1200 / 1800, suma exacta.
6. Idempotencia FICHA_OPERATIVA - CUMPLE. buscarPorReserva + guarda si-existe-no-crea,
   respaldado por reservaId @unique. Verificado en concurrencia (una sola ficha).
7. Contrato / SDK - CUMPLE. Endpoint POST /reservas/{id}/confirmar-senal (multipart) + schemas
   ConfirmarSenalResponse / ValidacionError / ConflictoError. SDK regenerado (no editado a mano).
   Errores mapeados a 422/409/404 con codigo de dominio; 401/403 via guards (RolesGuard, gestor).
8. Convenciones - CUMPLE. Arrow functions (metodos de clase NestJS exentos). Frontend Bulletproof
   (barrel index.ts unica API publica; compartido no importa de features; archivos <=300 lineas).
   Dialog/aviso mobile-first (footer apila en <sm, dl 1->2 col en sm:, tactiles h-12), sin px
   fijos que rompan. QA aporto evidencia Playwright (report step N+3).
9. AUDIT_LOG - CUMPLE. accion=transicion, entidad=RESERVA, datosAnteriores.estado=pre_reserva,
   datosNuevos.estado=reserva_confirmada, usuarioId del gestor, dentro de la tx. Una sola entrada.

## Auditoria de los puntos senalados por los agentes

- validate-openapi.py (encoding UTF-8) - ACEPTABLE. Cambio de una linea: open(path) ->
  open(path, encoding=utf-8). Fix correcto de un bug real (el contrato tiene caracteres no-ASCII;
  en Windows la codificacion por defecto no es UTF-8 y el fallback YAML del hook fallaba). No
  altera el linter principal (spectral/redocly) ni la semantica. Idealmente iria en un change de
  tooling aparte, pero es atomico, de bajo riesgo y prerequisito para que el hook de esta US
  funcione en el entorno. Menor (no bloqueante).
- UnidadDeTrabajoConfirmacionPort.ejecutar no generica (Promise<unknown> + cast) - ACEPTABLE como
  deuda menor. Cast a DocumentoCreado en un unico punto controlado; mismo patron que la UoW de
  US-014. Un ejecutar<T> generico eliminaria el cast. Nit.
- Adapters fake/stub (almacenar-justificante.fake, presentar-factura-senal.stub) - ACEPTABLE para
  el MVP. Ambos detras de puertos; el fake devuelve una URL determinista (como el PDF de US-014)
  y el stub es no-op post-commit. El almacenamiento real y la factura de senal (US-022) son
  anti-scope explicito. Menor: conviene ticket de seguimiento para el almacenamiento real del
  binario (hoy la URL persistida en DOCUMENTO.url no apunta a un objeto descargable).
- Frontend multipart con bodySerializer identidad + as-unknown-as - ACEPTABLE. Workaround
  idiomatico de openapi-fetch para multipart (el schema genera justificante:string); el
  serializer identidad deja que el navegador fije el Content-Type con boundary. El cliente
  generado NO se edita; el cast esta aislado y documentado en useConfirmarSenal. Nit.

## Hallazgos por severidad

### Bloqueante
- (ninguno)

### Mayor
- (ninguno)

### Menor
- [tooling] scripts/hooks/validate-openapi.py: fix de encoding UTF-8 correcto pero arrastrado en
  el change de US-021; idealmente en un change de tooling propio. Aceptado por bajo riesgo.
- [almacenamiento] almacenar-justificante.fake.adapter.ts: la url persistida en DOCUMENTO.url no
  es descargable (fake MVP). Recomendacion: ticket de seguimiento para el proveedor real.

### Nit
- [tipado] UnidadDeTrabajoConfirmacionPort.ejecutar podria ser generica (ejecutar<T>) para
  eliminar el cast a DocumentoCreado.
- [wiring] El puerto ClockPort (clock) se inyecta y se declara en deps pero el use-case no lo usa.
  Recomendacion: eliminar la dependencia clock (y su token/provider) o documentar por que se reserva.
- [multipart] as-unknown-as justificante:string + bodySerializer identidad en useConfirmarSenal:
  workaround estandar de openapi-fetch, correctamente aislado.

## Conclusion

El slice vertical cumple TODOS los guardrails duros (hexagonal, bloqueo atomico reutilizando la
primitiva de US-040 con SELECT ... FOR UPDATE + UNIQUE, multi-tenancy/RLS, maquina de estados
declarativa, importes en Decimal, contrato <-> SDK, AUDIT_LOG en tx, convenciones y responsive).
Tests en verde (68/68, con concurrencia real) y lint limpio en ambos apps. Los cuatro puntos
senalados por los agentes son aceptables (menores/nits), sin ningun bloqueante.

Veredicto: APTO
