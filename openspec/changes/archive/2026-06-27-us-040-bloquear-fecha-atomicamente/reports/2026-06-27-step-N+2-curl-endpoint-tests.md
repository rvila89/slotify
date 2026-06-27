# QA Report — Step N+2: Verificación Manual (Integración directa — sin curl)
**Change:** us-040-bloquear-fecha-atomicamente  
**Rama:** feature/us-040-bloquear-fecha-atomicamente  
**Fecha:** 2026-06-27  
**Agente:** qa-verifier  

---

## Justificación: por qué NO se usa curl

**Decisión D-7** del design (`design.md §D-7`): `bloquearFecha()` **no expone endpoint HTTP propio**.

Razones documentadas en el design:
1. El actor de UC-30 es "Sistema", no un usuario. El bloqueo es un efecto secundario de transiciones de estado de `RESERVA`, no una acción HTTP directa.
2. La US lo declara infraestructura: es una función de dominio compartida, análoga al motor de tarifa de US-016.
3. Exponer `POST /fechas-bloqueadas` rompería invariantes: el bloqueo debe ocurrir en la misma transacción que la transición de estado de la reserva.
4. Los endpoints invocantes (crear consulta con fecha, activar pre-reserva, etc.) pertenecen a otras US aún no implementadas (US-004/UC-03, US-014/UC-14).

**Consecuencia** (explícita en `design.md §D-7`): "la verificación de QA con curl (step-N+2) se hace **indirectamente** a través de un endpoint invocante ya existente que dispare un bloqueo, o, si ninguno está disponible aún en la rama, se cubre con **tests de integración del repositorio** (transacción real contra PostgreSQL) documentados en el report, dejando constancia del motivo."

**Verificación realizada:** no existe ningún endpoint HTTP en la rama actual que invoque `bloquearFecha()`. La verificación se realiza mediante los tests de integración que ejercitan el servicio de dominio con el adaptador Prisma real contra PostgreSQL (docker-compose `slotify-postgres`).

---

## Verificación caso happy — bloqueo blando 2.b

**Mecanismo:** `bloquear-fecha-integracion.spec.ts`, test `debe_insertar_bloqueo_blando_en_2b_con_ttl_leido_de_settings`.

**Operación ejercitada:**
```typescript
const servicio = new BloquearFechaService({
  repositorio: new FechaBloqueadaPrismaAdapter(prisma),
  tenantSettings: settingsPortReal,   // lee de BD: ttl_consulta_dias=3
  clock: { ahora: () => new Date('2026-06-27T00:00:00.000Z') },
});

await servicio.ejecutar({
  tenantId: '00000000-0000-0000-0000-000000000001',
  fase: '2.b',
  fecha: new Date('2026-09-12T00:00:00.000Z'),
  reserva: { idReserva: reservaA, tenantId: '00000000-0000-0000-0000-000000000001' },
});
```

**Fila resultante en `fecha_bloqueada` (verificada con Prisma tras el INSERT):**
```
tipo_bloqueo  : 'blando'
ttl_expiracion: 2026-06-30T00:00:00.000Z   (now() + 3 días, leído de TENANT_SETTINGS)
reserva_id    : <reservaA>                  (preservado)
tenant_id     : 00000000-0000-0000-0000-000000000001
fecha         : 2026-09-12T00:00:00.000Z
```

**Resultado:** PASS

---

## Verificación caso upgrade firme — reserva_confirmada

**Operación ejercitada:**
```typescript
// Paso 1: bloqueo blando 2.b
const blando = await servicio.ejecutar(comando(reservaA));               // tipo=blando, ttl!=null
// Paso 2: upgrade a firme
const firme = await servicio.ejecutar(comando(reservaA, { fase: 'reserva_confirmada' }));
```

**Fila verificada tras upgrade:**
```
tipo_bloqueo  : 'firme'
ttl_expiracion: null    (chk_firme_sin_ttl satisfecho)
reserva_id    : <reservaA>  (preservado — es UPDATE de la misma fila, no DELETE+INSERT)
id_bloqueo    : mismo UUID que el blando (UPDATE, no INSERT nuevo)
```

**Resultado:** PASS

---

## Verificación caso rechazo — fecha ya ocupada por otra reserva

**Operación ejercitada:**
```typescript
// Primero bloquea reservaA
await servicio.ejecutar(comando(reservaA));

// Intenta bloquear la misma (tenant, fecha) con reservaB
await servicio.ejecutar(comando(reservaB));
// -> lanza FechaYaBloqueadaError (traducción de P2002)
```

**Resultado observado:**
- La segunda llamada lanza `FechaYaBloqueadaError` con `codigo: 'FECHA_YA_BLOQUEADA'`
- No se inserta fila adicional
- `COUNT(*) WHERE tenant_id=... AND fecha=... = 1` (solo la de reservaA)

**Resultado:** PASS

---

## Verificación caso concurrencia (zona crítica)

**Operación ejercitada:**
```typescript
const resultados = await Promise.allSettled([
  servicio.ejecutar(comando(reservaA)),   // transacción TX-1
  servicio.ejecutar(comando(reservaB)),   // transacción TX-2
]);
// -> 1 fulfilled + 1 rejected(FechaYaBloqueadaError)
// -> COUNT = 1 en BD
```

**Resultado:** PASS — 1 éxito determinista + 1 `FechaYaBloqueadaError`

---

## Verificación BD post-verificación

**Comandos ejecutados:**
```sql
SELECT COUNT(*) FROM fecha_bloqueada;
-- Resultado: 0

SELECT COUNT(*) FROM reserva;
-- Resultado: 0

SELECT COUNT(*) FROM cliente;
-- Resultado: 0
```

Los hooks `afterAll` y `afterEach` de los tests de integración limpian todas las filas de prueba. BD restaurada al baseline.

---

## Resumen de verificaciones

| Caso | Mecanismo | Resultado |
|------|-----------|-----------|
| Bloqueo blando 2.b (`tipo='blando'`, `ttl=now()+3d`) | Test integración (BD real) | PASS |
| Upgrade blando→firme (`tipo='firme'`, `ttl=null`) | Test integración (BD real) | PASS |
| Rechazo P2002 (`FECHA_YA_BLOQUEADA`, sin fila adicional) | Test integración (BD real) | PASS |
| Concurrencia: 1 éxito + 1 rechazo deterministas | Test integración (BD real) | PASS |
| Restauración BD post-verificación | psql count | PASS (0/0/0) |

---

## Outcome

**PASS** (verificación indirecta por D-7 — sin endpoint HTTP propio, conforme al design aprobado).

El step N+2 queda cubierto por los tests de integración que ejercitan el flujo completo dominio→adaptador→PostgreSQL. Cuando los flujos invocantes (US-004, US-014) expongan sus endpoints, el QA de esos changes verificará el bloqueo end-to-end vía HTTP.
