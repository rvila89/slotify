# QA Report — consulta-fecha-borrador-fix

Ejecutado desde la sesión principal (con Postgres + API + Web reales del worktree).

## 1. Unit / component tests

- **Frontend** (`pnpm --filter @slotify/web test -- --run src/features/reservas src/features/comunicaciones`):
  **48 files, 323 tests PASS**. Incluye: invalidación de comunicaciones tras fecha, dedupe de
  "Editar consulta", "Cambiar fecha" en 2b/2c/2v, desbloqueo parcial con borrador E1, aviso ámbar.
- **Backend** (jest, specs del change + no-regresión):
  **17 suites, 191 tests PASS** (plantilla-transicion-fecha, texto-plano-a-html,
  resend.email.adapter.formato, actualizar-reserva*, enviar-borrador, despachar-email, catálogo,
  alta-consulta). Tras el fix de `personas` (ver §3): `actualizar-reserva-regenera-borrador`
  **9 tests PASS** (2 nuevos de regresión).
- **Lint**: `pnpm --filter @slotify/web lint` y `--filter @slotify/api lint` → **0 errores**
  (warnings de deprecación de `boundaries` y 1 warning pre-existente en un spec ajeno).

## 2. Smoke real contra BD (curl al API del worktree, puerto 3001, sandbox)

Flujo `2a → asignar fecha → PATCH invitados/duración → borrador regenerado` sobre `slotify_dev`:

- Consulta `2a` creada; `POST /reservas/{id}/fecha` → `2b`; borrador E1 creado con asunto
  **"Pre-reserva confirmada"** y cuerpo con placeholder `___` (personas/horas).
- `GET /reservas/{id}` → `tieneBorradorE1Pendiente: true` (la UI depende de este flag).
- `PATCH /reservas/{id}` con `numAdultosNinosMayores4=40, duracionHoras=8` → borrador
  **regenerado in situ**: sigue `borrador`, sin `___`, cuerpo "para **40 personas y 8 horas**",
  asunto "Pre-reserva confirmada". **Valida los nuevos adaptadores Prisma**
  (`cargar-borrador-e1-pendiente`, `cargar-reserva-actualizable` con `idioma`/`nombre`) y el
  cableado de regeneración contra BD real (riesgo `us049`).

## 3. Bug encontrado en E2E y corregido (regresión cubierta)

**Síntoma**: tras editar la consulta en la UI, el borrador mostraba "para **___** personas y 8
horas" (horas sí, personas no). **Causa**: la regeneración leía `numInvitadosFinal`, pero el editor
de consulta escribe `numAdultosNinosMayores4`. **Fix**: `personas` usa el aforo canónico
(`numInvitadosFinal ?? numAdultosNinosMayores4 + numNinosMenores4`), espejo de `aforoDeReserva`
(US-050), en `actualizar-reserva.use-case.ts` (helper puro `derivarPersonasBorrador`). Cubierto con
2 tests nuevos + re-verificado por curl real (personas=40). Los unit tests originales usaban
`numInvitadosFinal` y enmascaraban el fallo (lección `contract-matching-key-mismatch`).

## 4. E2E visual (Playwright, web 5175 → API 3001)

Capturas en `reports/e2e-screenshots/`:

- `e2e-01-ficha-2a-un-solo-editar.png`: consulta `2a` con **un solo** "Editar consulta" + CTA
  "Añadir fecha" junto a "Generar presupuesto" deshabilitado (dedupe OK).
- `e2e-02-aviso-ambar-desbloqueo-parcial-borrador.png`: tras asignar fecha → **aviso ámbar**
  "borrador de confirmación pendiente de revisión y envío… desde Comunicaciones" (no verde "email
  enviado"); acciones en **desbloqueo parcial** ("Editar consulta" + "Cambiar fecha"); la sección
  Comunicaciones muestra el borrador E1 **"Pre-reserva confirmada"** al instante (invalidación OK).
  Estilo del aviso verificado por computed style: `bg-amber-50 / border-amber-200 / text-amber-900`.
- `e2e-03-estado-final-2b-borrador-datos.png`: modal "Editar consulta" **sin sección de fecha**;
  Detalles del evento con 8h / 11:00 / 40 invitados.
- `e2e-04-responsive-390.png`, `e2e-05-responsive-768.png`: **sin overflow horizontal**
  (390: scrollW 375≤390; 768: scrollW 753≤768).

**No verificado en E2E** (sesión JWT expirada por pausa larga; sin impacto en el cambio):
el envío del borrador y el subsiguiente desbloqueo total de acciones. Cubierto por: el test de
componente de `AccionesConsulta` (todas las acciones vuelven con `tieneBorradorE1Pendiente=false`),
el spec de conversión texto→HTML del borde de envío (formato del email preservado) y el flujo
US-046 de envío, que este change no modifica.

## Veredicto QA: OK (con la corrección del bug de `personas` aplicada y re-verificada).
