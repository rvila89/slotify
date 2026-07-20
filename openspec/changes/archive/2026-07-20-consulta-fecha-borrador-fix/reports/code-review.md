# Informe de code-review - consulta-fecha-borrador-fix

- Fecha: 2026-07-19
- Revisor: code-reviewer (solo lectura)
- Rama: worktree-consulta-fecha-borrador-fix - base master
- Diff revisado: git diff contra el merge-base 6ff9bc4; 27 archivos versionados mas 9 nuevos. Lint ESLint sobre los archivos tocados de apps/web y apps/api: exit 0 (solo warnings de deprecacion de boundaries).

Nota de contexto: git diff master muestra ademas ~30 archivos de app-shell/layout como borrados. NO son cambios de esta rama: master avanzo al mergear el PR 85 (layout-appshell) que esta rama aun no tiene. La revision se hace contra el merge-base. Recomendacion (no bloqueante): rebasar master antes del PR.

---

## Resumen

Correccion del flujo consulta sin fecha. Backend: renombra el asunto E1 rama disponible a Pre-reserva confirmada (ES/CA); extrae el helper puro textoPlanoAHtml mas htmlEscape; anade el flag cuerpoEsHtml en EnviarEmailComando y lo fija por origen; regenera best-effort el borrador E1 al editar la consulta via nuevos puertos/adaptadores. Frontend: invalidacion de comunicacionesReservaQueryKey, aviso ambar mas scroll-to-top, desbloqueo parcial con borrador E1 pendiente, dedupe de Editar consulta y separacion de la gestion de fecha (AccionCambiarFecha) de la edicion de campos.

Implementacion coherente con proposal.md/design.md y con los spec-delta de consultas y comunicaciones. Guardrails criticos (bloqueo atomico, hexagonal, multi-tenancy, contrato) respetados.

---

## Hallazgos por severidad

### Bloqueantes
- Ninguno.

### Altas
- Ninguna.

### Medias
- [email/heuristica] EnviarBorradorUseCase distingue el formato por heuristica, no por flag. Fichero enviar-borrador.use-case.ts:151 - contieneMarcadoHtml clasifica como HTML cualquier cuerpo con marcado de bloque (p, br, div, ul, ol, li). El design.md D-2 lo admite explicitamente (decision final en TDD), y los tres constructores de EnviarEmailComando quedan cubiertos (catalogo directo y alta E1 con true; envio de borrador con heuristica). Riesgo residual: un borrador manual en texto plano donde el gestor escriba etiquetas de bloque literales se enviaria sin escapar (mal render, no vulnerabilidad; contenido del propio gestor). Recomendacion: persistir un campo de formato explicito en COMUNICACION para borradores manuales en un change futuro. No bloqueante.

### Bajas
- [render] Fallback fechaEvento con new Date de respaldo en la regeneracion del borrador. Fichero actualizar-reserva.use-case.ts (regenerarBorradorE1SiProcede). Si existe borrador E1 la reserva esta en 2b/2d con fecha, asi que el fallback no deberia dispararse; si lo hiciera, mostraria la fecha de hoy sin senalarlo. Recomendacion: omitir la regeneracion cuando no haya fecha. No bloqueante.
- [hexagonal, PRE-EXISTENTE] Import app hacia infra en plantilla-transicion-fecha.ts:25 (formatarFechaCA/ES desde comunicaciones/infrastructure/plantillas/formato-fecha). Modulo de formateo puro, el hook no-infra-in-domain no lo marca, ya existia en el merge-base (este change solo toco las cadenas de asunto). Deuda de ubicacion ajena al alcance.

---

## Verificacion del checklist

- Hexagonal / DDD: OK. textoPlanoAHtml/htmlEscape puros (sin nestjs ni prisma); el puerto enviar-email.port.ts sigue puro; los nuevos puertos CargarBorradorE1PendientePort y RegenerarBorradorE1Port viven en aplicacion y sus adaptadores en infraestructura. El adaptador de transporte importa el helper de application (infra hacia app, permitido). Unico app hacia infra es pre-existente (Baja).
- Bloqueo atomico de fecha: OK e INTACTO. El PATCH solo persiste CLAVES_SIMPLES (excluye fechaEvento/estado/subEstado), con escenario de spec que verifica que no muta la fecha aunque se intente. La regeneracion del borrador es post-commit best-effort fuera de la unidad de trabajo; no toca bloquearFecha/liberarFecha ni Redis/locks distribuidos.
- Multi-tenancy / RLS: OK. cargar-borrador-e1-pendiente.prisma.adapter.ts filtra por reservaId y tenantId y fija app.tenant_id con fijarTenant(tx); cargar-reserva-actualizable mantiene el mismo patron. El tenant viaja en el comando (JWT), nunca del body/path.
- Maquina de estados: OK. El PATCH no altera estado/sub-estado; el tipo del render se deriva del sub-estado (2d cola, resto disponible) sin if/else dispersos.
- Contrato OpenAPI / SDK: OK. Sin cambios en api-spec.yml ni en el cliente generado (verificado: ningun archivo del cliente generado tocado), coherente con design.md D-1.
- Cliente del frontend: OK. No editado a mano.
- Tipos y datos: OK. TS strict; sin any injustificado; el flag es boolean opcional retro-compatible. No hay importes monetarios en este change.
- Estructura frontend por dominio: OK. AccionCambiarFecha/AccionesBorradorPendiente co-localizados en FichaConsulta/components; se importa comunicacionesReservaQueryKey por el barrel de comunicaciones (API publica, no archivo interno); FechaConsultaSeccion eliminado sin referencias colgantes.
- max-lines 300 y arrow-functions: OK. ESLint pasa (exit 0). El change reduce AccionesConsulta (375 a 366 lineas crudas) y EditarConsultaDialog (319 a 313) extrayendo sub-componentes; con skipBlankLines y skipComments todos quedan bajo 300.
- Responsive mobile-first: OK en codigo (botones nuevos con w-full sm:w-auto). Advertencia de evidencia: en el diff figuran BORRADAS las capturas E2E de 3 viewports (por el desfase con master, no por el change). Antes de cerrar debe existir evidencia 390/768/1280 del flujo tocado. Aportarla en QA; no bloquea la revision de codigo.
- Tests primero (TDD): OK. Cobertura nueva coherente con los spec-delta y no debilitada: resend.email.adapter.formato.spec.ts (conversion texto a HTML y no-regresion E1/E2/E3 intacto sin doble-escape); texto-plano-a-html.spec.ts (helper puro); plantilla-transicion-fecha.spec.ts (asunto Pre-reserva confirmada ES/CA y rama cola sin cambios); actualizar-reserva-regenera-borrador.use-case.spec.ts (disponible/cola, idioma ca, sin borrador, best-effort, sin 409); frontend AccionesConsulta.test.tsx (dedupe, cambiar-fecha por sub-estado, desbloqueo parcial, downstream bloqueadas), AvisosTransicion.test.tsx, invalidacionComunicacionesFecha.test.tsx. Nota: los tests de aplicacion usan dobles (sin Postgres); el de INTEGRACION SQL real de la regeneracion (Prisma mas RLS) debe ejecutarse desde la sesion principal en QA.
- Convenciones e idioma: OK. Nombres en espanol; comentarios y textos de UI/errores en espanol.

---

## Riesgo de doble-escape del email (foco solicitado)

Verificado en TODOS los constructores de EnviarEmailComando:
- DespacharEmailService.construirComandoEnvio (despacho directo y reenvio del catalogo E1/E2/E3): cuerpoEsHtml true. Correcto.
- AltaConsultaUseCase (E1 del alta, HTML del catalogo): cuerpoEsHtml true. Correcto.
- DespacharEmailService.finalizarEnvio: propaga cuerpoEsHtml del llamador.
- EnviarBorradorUseCase: heuristica contieneMarcadoHtml (E1 de transicion y manual en texto plano dan false; borrador de catalogo da true). Cubierto por tests de no-regresion. Residual documentado en Medias.
- ResendEmailAdapter.enviar: si cuerpoEsHtml es true, html igual al cuerpo intacto; en caso contrario html igual a textoPlanoAHtml(cuerpo); text siempre crudo. Correcto.

No se detecta ningun camino que doble-escape el catalogo ni que envie texto plano sin convertir.

---

## Veredicto: APTO

No hay hallazgos Bloqueantes ni Altos. Las observaciones Medias/Bajas son mejoras o deuda pre-existente que no impiden el merge. Condicion previa al cierre (QA, no code-review): aportar evidencia responsive en 3 viewports (390/768/1280) del flujo de este change y ejecutar el test de integracion SQL real de la regeneracion del borrador. Recomendable rebasar master antes del PR para no reintroducir borrados del layout-appshell.

---

## Adenda: fix de personas (revision incremental)

- Fecha: 2026-07-20
- Delta revisado: git diff master acotado a `actualizar-reserva.use-case.ts` y `actualizar-reserva-regenera-borrador.use-case.spec.ts`.
- Motivo: bug hallado en E2E. El editor de consulta escribe `numAdultosNinosMayores4` (campo "Invitados adultos y ninos > 4"), NO `numInvitadosFinal`, asi que el borrador E1 regenerado mostraba `___` para personas pese a haberse introducido el aforo.

### Cambio

Se anade el helper puro `derivarPersonasBorrador(reserva)` en `actualizar-reserva.use-case.ts` y la regeneracion pasa `personas: derivarPersonasBorrador(reserva)` en vez de `reserva.numInvitadosFinal`.

### Verificacion contra guardrails

- Pureza / hexagonal: OK. `derivarPersonasBorrador` es una arrow pura, sin efectos, sin imports de `@nestjs/*`/`@prisma/*`/infra; recibe un `Pick` de campos primitivos y devuelve `number | null`. No introduce dependencias nuevas.
- Coherencia con `aforoDeReserva` (US-050, frontend `apps/web/src/features/reservas/lib/aforo.ts`): OK, es un ESPEJO EXACTO. Misma logica linea por linea: `numInvitadosFinal` cuando `!= null`; si no, `null` cuando adultos y ninos son ambos `null`; en otro caso `(adultos ?? 0) + (ninos ?? 0)`. Mismo criterio de coalescencia y mismo caso `null` para que la plantilla interpole `___`. El aforo del borrador queda alineado con el aforo mostrado en Kanban/Listado.
- Contrato / SDK: OK. Cambio interno de la capa de aplicacion; no toca `api-spec.yml` ni el cliente generado. La firma de `renderMensajeTransicionFecha` ya aceptaba `personas: number | null` y `valorOplaceholder(null)` produce `___`, asi que el tipo encaja sin cambios.
- Bloqueo atomico de fecha: OK e INTACTO. El helper solo lee campos de aforo; sigue fuera de la unidad de trabajo (post-commit best-effort). No toca `bloquearFecha`/`liberarFecha` ni introduce Redis/locks.
- Multi-tenancy / maquina de estados: OK. No altera el scoping por `tenant_id` ni estado/sub-estado; el `tipo` (2d cola, resto disponible) no cambia.
- Tests no debilitados: OK, REFORZADOS. Se anaden 2 casos de regresion reales que habrian fallado antes del fix: `debe_usar_numAdultosNinosMayores4_como_personas_cuando_no_hay_numInvitadosFinal` (40 -> "40 personas", sin `___`) y `debe_sumar_numAdultosNinosMayores4_y_numNinosMenores4_como_aforo` (40 + 5 -> "45 personas"). El caso original con `numInvitadosFinal` se mantiene; ninguna asercion se relaja (siguen las comprobaciones `not.toContain('___')`).

### Hallazgos de la adenda

Ninguno nuevo (Bloqueante/Alto/Medio/Bajo). Persiste el hallazgo Bajo previo sobre el fallback `new Date()` de `fechaEvento`, ajeno a este delta.

## Veredicto final (tras la adenda): APTO

El fix corrige el bug de personas sin degradar guardrails ni tests, con paridad exacta frente a `aforoDeReserva`. El veredicto APTO se mantiene. Condiciones previas al cierre (QA, no code-review) sin cambios: evidencia responsive en 3 viewports (390/768/1280) y test de integracion SQL real de la regeneracion del borrador; recomendable rebasar master antes del PR.
