# Report — Step 7: Pruebas manuales con curl

**Change:** `email-transicion-fecha-borrador`
**Fecha:** 2026-07-18
**Entorno:** API arrancada por la sesión principal en `:3010` (prefijo `/api`) contra `slotify_dev`
(Postgres docker `slotify-postgres`), `EMAIL_TRANSPORT=fake`. Login gestor
`info@masialencis.com`. **BD de dev restaurada al final** (0 residuos).

## Caso 1 — Rama LIBRE (`2a → 2b`), idioma `ca`, personas ausente

1. `POST /api/reservas` → alta consulta exploratoria (sin fecha), `idioma:'ca'`,
   `duracionHoras:8`, cliente "Jatinder". Respuesta `subEstado:'2a'`. ✅
2. `POST /api/reservas/:id/fecha` `{"fechaEvento":"2026-09-15"}` → `subEstado:'2b'`,
   `ttlExpiracion` a +3 días. ✅
3. **BD `comunicacion`:**

```
codigo_email | estado   | fecha_envio | asunto
E1           | borrador | (null)      | La data que ens proposes està disponible
```

Cuerpo (verbatim):

```
Hola Jatinder,

Moltes gràcies per la teva resposta i per compartir-nos la data! 😊
He revisat la disponibilitat i tinc una bona notícia: la data que ens proposes, 15 de setembre de 2026, està actualment disponible.
Si et sembla bé, et preparo el pressupost per a ___ persones i 8 hores pel 15 de setembre de 2026 perquè puguis fer el pagament del 40% i així deixar la reserva confirmada. ...
...
Una abraçada, Ari — Masia l'Encís
```

Comprobado: **`estado=borrador`, `fecha_envio=null`** (no se auto-envía) · catalán · fecha
formateada · **placeholder `___` en personas** (numInvitadosFinal ausente) · **`8 hores`** ·
firma · "40%" fijo. ✅

## Caso 2 — Rama COLA (`2a → 2d`), idioma `es`

1. `POST /api/reservas` → 2ª consulta exploratoria, `idioma:'es'`, cliente "Marta". ✅
2. `POST /api/reservas/:id/fecha` `{"fechaEvento":"2026-09-15"}` (fecha ya bloqueada por el
   caso 1) **sin** `aceptarCola` → **HTTP 409** `colaDisponible:true`
   (`"...puedes entrar en la lista de espera."`). ✅
3. Reintento con `{"fechaEvento":"2026-09-15","aceptarCola":true}` → `subEstado:'2d'`,
   `posicionCola:1`. ✅
4. **BD `comunicacion`:**

```
codigo_email | estado   | fecha_envio | asunto
E1           | borrador | (null)      | Sobre la fecha que propones
```

Cuerpo (verbatim, castellano):

```
Hola Marta,

¡Muchas gracias por tu respuesta y por compartirnos la fecha! 😊
En cuanto a la fecha que nos propones, 15 de septiembre de 2026, actualmente está bloqueada por otra consulta que estamos gestionando.
...
Un abrazo, Ari — Masia l'Encís
```

Comprobado: **`estado=borrador`, `fecha_envio=null`** · castellano · plantilla "cola". ✅

## Caso 3 — No encolable / cola no aceptada
El intento del caso 2 sin `aceptarCola` (409) **no creó ninguna `COMUNICACION`** para esa
reserva hasta aceptar la cola (verificado indirectamente: la única fila E1 de RID2 es la "cola"
creada tras aceptar). Coherente con el escenario de integración `count===0`.

## Limpieza
`DELETE` de las 2 comunicaciones, 6 audit_log, 1 fecha_bloqueada, 2 reservas y 2 clientes de
prueba. Verificación post-limpieza: `reserva=0`, `comunicacion(QA)=0`, `fecha_bloqueada(2026-09-15)=0`,
`audit_log(QA)=0`. API detenida (puerto 3010 liberado).

**Paso 7: OK** — el endpoint deja el correo en `borrador` sin envío, con la redacción dinámica
correcta por idioma/rama, en ambas ramas y con el placeholder funcionando.
