# Informe de revisión — change `2026-07-20-descarte-aviso-inline-ficha`

Rama: `feature/descarte-aviso-inline-ficha` (diff vs `master`, working tree).
Alcance: solo frontend (`apps/web`), presentación pura. Sustituye el
`toast.success()` de Sonner por un aviso inline verde en la cabecera de la ficha
al descartar una pre-reserva (US-011) y una consulta (US-013), con scroll al
inicio. No toca contrato, backend, Prisma, BD ni SDK.

## Resumen de verificación

- `pnpm lint` (apps/web): exit 0. Solo warnings pre-existentes de deprecación del
  plugin `boundaries` (no violaciones).
- Tests del change: 6/6 verdes
  (`AvisoDescarte.test.tsx` 4, `DescartarConsultaDialog.test.tsx` 1,
  `DescartarPreReservaDialog.test.tsx` 1). Suite web completa: 362/362.
- `<Toaster/>` sigue montado en `App.tsx:36`; el test `toaster-montado` pasa.

## Hallazgos

### Bloqueantes
- Ninguno.

### Mayores
- Ninguno.

### Menores
- [coherencia] Los diálogos siguen recibiendo `codigo={reserva.codigo}` en
  `DialogosFicha.tsx:194,201` aunque la prop `codigo` ya no se usa dentro de los
  diálogos (pasó a opcional y el aviso inline lee `reserva.codigo` en
  `AvisosFicha.tsx:90`). No rompe nada, pero es una prop pasada sin efecto. La
  documentación de la prop en ambos diálogos explica correctamente el porqué de
  conservarla. Recomendación: opcional; podría eliminarse el paso de `codigo` en
  `DialogosFicha` en un pulido futuro, o dejarse por simetría con los demás
  diálogos que sí la usan (`ArchivarReservaDialog`).

### Nits
- [comentario] Los JSDoc de `Props.codigo` en ambos diálogos siguen describiendo
  el código "para el aviso inline vía onDescartado"; correcto, pero el diálogo ya
  no consume la prop. Consistente con el punto menor anterior.

## Checklist de guardrails

- Arrow functions (no `function`): OK. `AvisoDescarte`, callbacks y componentes
  son arrow functions.
- `components/` solo `.tsx`: OK. El nuevo `AvisoDescarte.tsx` es un componente
  React puro; no introduce helpers/tipos/constantes en `components/`.
- `max-lines` ≤300 (skipBlankLines/skipComments): OK. `FichaConsultaPage.tsx`
  (346 raw) queda bajo el límite efectivo; lint exit 0 lo confirma.
- Boundaries: OK. No se importan archivos internos de otras features; la capa
  compartida no importa de `features/`. `AvisoDescarte` se consume dentro de la
  propia feature.
- Estructura por dominio: OK. El sub-componente privado vive en
  `pages/FichaConsulta/components/`, no plano en la raíz de la página.
- Responsive / mobile-first: OK. `AvisoDescarte` usa `flex items-start gap-3`,
  `flex-1`, sin anchos px fijos; hereda el ancho del contenedor de avisos de la
  cabecera (mismo patrón que `AvisoVisitaProgramada`). Sin overflow.
- SDK generado no editado: OK. No hay cambios en `api-client/`.
- Redis / lock distribuido: N/A (cambio de presentación).

## Correctitud del wiring

- `FichaConsultaPage` limpia `resultadoDescarte` al abrir ambos diálogos
  (`onDescartarConsulta`/`onDescartarPreReserva` hacen `setResultadoDescarte(null)`
  antes de abrir): OK.
- Setea el aviso + `window.scrollTo({ top: 0, behavior: 'smooth' })` solo en éxito
  (dentro de `onDescartado`/`onDescartadoPreReserva`, que solo se disparan en el
  `onSuccess` del diálogo): OK.
- Ambos callbacks reciben la `Reserva` y la propagan a `AvisosFicha` con su `tipo`
  (`'consulta'` / `'prereserva'`): OK.
- `AvisoDescarte` lee `reserva.codigo` (tipo `string` no-opcional en el schema):
  OK, sin riesgo de `undefined`.

## Coherencia visual con `AvisoVisitaProgramada`

- Mismas clases del banner esmeralda (`border-emerald-200 bg-emerald-50
  text-emerald-900`, `rounded-[16px]`, `p-4`), ícono `text-emerald-600`,
  `role="status"`, botón cerrar con `aria-label="Cerrar aviso"` y estilo idéntico.
- `data-testid` diferenciado por tipo
  (`alerta-descarte-consulta` / `alerta-descarte-prereserva`): OK.

## Sin regresiones

- `<Toaster/>` sigue montado (otros dominios lo usan): OK.
- Imports `toast` de Sonner eliminados de ambos diálogos: OK (solo quedan
  menciones en comentarios).
- Sin uso muerto de `codigo` funcional: la prop quedó opcional y sin lectura en
  los diálogos (ver menor).

## Tests

- Cubren ambos `tipo` (consulta / prereserva) en `AvisoDescarte.test.tsx`,
  incluida clase esmeralda, `role="status"` y el botón cerrar.
- Los tests de diálogo verifican (a) que `toast.success` NO se invoca y (b) que
  `onDescartado(reserva)` sí se notifica; el test de consulta ya no espera el
  toast y ya no monta `<Toaster/>`.

Veredicto: APTO

---

# 2ª pasada — "un solo aviso de desenlace visible (el último)"

Fecha: 2026-07-20. Alcance añadido: extraer la gestión de TODOS los avisos de la
ficha a un hook `useAvisosFicha` que garantiza el invariante "como máximo un aviso
visible a la vez (el último)". Sigue siendo solo frontend / presentación pura.

Archivos de esta parte:
- NUEVO `pages/FichaConsulta/useAvisosFicha.ts` (174 líneas)
- `pages/FichaConsulta/FichaConsultaPage.tsx` (rewire al hook; 313 líneas)
- NUEVO test `pages/FichaConsulta/__tests__/useAvisosFicha.test.ts`

## Resumen de verificación

- `pnpm --filter web lint`: exit 0 (solo warnings pre-existentes de deprecación de
  `boundaries`, ajenos al change).
- `pnpm --filter web test`: 62 files / 368 tests, todos verdes (incluye los 6
  nuevos del invariante y `toaster-montado`).
- `max-lines` ≤300: `useAvisosFicha.ts` 174, `FichaConsultaPage.tsx` 313 raw
  (bajo el límite efectivo con skipBlankLines/skipComments; lint exit 0 lo
  confirma), `AvisosFicha.tsx` 115, `AvisoDescarte.tsx` 51.
- Alcance: `git status` solo muestra ficheros de reservas (presentación) + docs +
  openspec. Sin SDK (`api-client/`), sin api-spec, sin backend/Prisma, sin otros
  dominios. `AvisosEdicionPresupuesto.tsx` sin cambios vs master.

## Correctitud del invariante

- El hook mantiene 12 slots de aviso + `emailEnviado`. `cerrar()` pone TODOS a
  null/false (`useAvisosFicha.ts:40-54`).
- Cada `mostrar*` invoca `cerrar()` ANTES de fijar su propio estado
  (`useAvisosFicha.ts:56-143`): imposible que queden >1 no nulos tras una llamada.
  React agrupa las actualizaciones (`cerrar` + el `setX` propio) en el mismo
  handler, así que no hay parpadeo intermedio observable.
- `mostrarEmailEnviado()` limpia todo y activa el flag (`:140-143`).
- `mostrarResultadoFecha(null)` en la página sigue equivaliendo a limpiar: llama a
  `avisos.cerrar()` y retorna (`FichaConsultaPage.tsx:81-90`). Preserva la
  semántica del `setResultado(null)` de master.

## Rewire de la página (fiel a master)

- Todos los `onCerrar*` de `AvisosFicha` apuntan a `avisos.cerrar`
  (`FichaConsultaPage.tsx:118-132`): al ser un único aviso visible, cerrar cualquiera
  equivale a limpiar; correcto.
- Cada handler de éxito llama a la `mostrar*` correcta:
  `onResueltoInvitados→mostrarInvitados`, `Visita→mostrarVisita`,
  `Interesado→mostrarInteresado`, `ReservaInmediata→mostrarReservaInmediata`,
  `Extension→mostrarExtension`, `ConfirmadoPresupuesto→mostrarPresupuesto`,
  `Editado/Reenviado→mostrarEdicion({clase})`, `Senal→mostrarSenal`,
  `Forzado→mostrarForzar`, `Finalizado→mostrarFinalizar`,
  `Descartado/DescartadoPreReserva→mostrarDescarte({tipo})`,
  `onEmailEnviado→mostrarEmailEnviado` (`:243-308`). Sin avisos perdidos ni cruzados.
- `window.scrollTo` conservado donde existía en master: fecha (`:87-89`),
  presupuesto (`:288-290`), descarte consulta (`:303`) y pre-reserva (`:307`),
  email (`:245-247`). No se añadió scroll donde no lo había.
- Comportamiento de error intacto: los `mostrar*`/scroll viven en los callbacks de
  éxito de los diálogos; un fallo no dispara aviso ni scroll.
- Los handlers de abrir diálogo ocultan el banner al iniciar la acción: todos los
  `onXxx` de `AccionesConsulta` hacen `avisos.cerrar()` antes de abrir
  (`:182-235`). En master `onRegistrarResultadoVisita` limpiaba dos estados;
  `avisos.cerrar()` es un superconjunto correcto. `onEditarConsulta` y
  `onArchivarReserva` no limpiaban en master y siguen sin hacerlo (paridad).

## Sin regresiones

- `AvisosFicha.tsx` mantiene el orden de render y todas las ramas condicionales;
  el único cambio vs master es la adición del aviso de descarte (1ª pasada).
- `<Toaster/>` sigue montado (test `toaster-montado` verde).
- Ningún aviso existente (fecha 2b/2d, invitados, visita, interesado, reserva
  inmediata, extensión, presupuesto, edición, señal, forzar, finalizar, email,
  descarte) queda sin ruta de `mostrar`/`cerrar`.

## Guardrails

- Arrow functions: OK. El hook y todos los `mostrar*`/`cerrar` son arrow +
  `useCallback`; deps correctas (`[cerrar]`, y `cerrar` con `[]`).
- Hook `.ts` fuera de `components/`: OK, vive en `pages/FichaConsulta/`.
- Boundaries: OK. El hook importa tipos por barrels públicos
  (`@/features/presupuestos`, `@/features/confirmacion`, `@/api-client`) y tipos
  relativos de la propia feature; no cruza internals de otras features.
- SDK no editado, sin api-spec/backend: OK.

## Hallazgos

### Bloqueantes
- Ninguno.

### Mayores
- Ninguno.

### Menores / Nits
- Se arrastran los menores de la 1ª pasada (prop `codigo` pasada a los diálogos sin
  consumirse). Sin cambios; sigue sin romper nada.

Veredicto 2ª pasada: APTO
