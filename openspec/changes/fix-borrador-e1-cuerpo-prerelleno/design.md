# Design — fix-borrador-e1-cuerpo-prerelleno

> Decisiones técnicas del fix. Las abiertas requieren visto bueno humano en el **Gate de
> revisión SDD** antes de contrato/TDD/implementación. Ámbito reducido: corrige un bug de
> comportamiento sobre US-045/US-047 (archivadas), **sin migración de esquema propia** y sin
> cambio de contrato ni frontend.

## Contexto

`AltaConsultaUseCase` crea la fila E1 en `borrador` **dentro de la transacción** del alta
(con `cuerpo: ''`, placeholder) para preservar la atomicidad US-003, y **renderiza el cuerpo
real post-commit** porque la casuística `tipoE1` depende del sub-estado ya commiteado. Hoy ese
render solo ocurre en la rama de auto-envío (sin comentarios); con comentarios el post-commit
retorna antes de renderizar y el borrador queda vacío. El envío manual posterior
(`EnviarBorradorUseCase`, US-046) manda `comando.cuerpo ?? comunicacion.cuerpo`: si el gestor
no edita, reenvía el cuerpo persistido → hoy enviaría vacío. Rellenar el borrador al alta es
la corrección de raíz.

## Decisiones

### D-1: El UPDATE post-commit reutiliza el `DespacharEmailService` ya inyectado (Opción A)

El repositorio de `COMUNICACION` **no** está disponible a nivel de `deps` del alta: dentro de
la transacción se usa `repos.comunicaciones` (tx-bound, inutilizable tras el commit). Para el
UPDATE post-commit se añade un método `actualizarContenidoBorrador(...)` al
`ComunicacionRepositoryPort` (dominio) y se expone a través del **`DespacharEmailService`**,
que **ya está inyectado en el alta** como `deps.finalizarEnvio` y ya posee internamente ese
repositorio. `AltaConsultaDeps` gana un puerto estrecho `ActualizarBorradorEmailPort`
(`actualizarContenidoBorrador`) satisfecho por el mismo `DespacharEmailService` por tipado
estructural.

- **Ventaja**: **sin wiring nuevo ni tokens nuevos** (el token `COMUNICACION_REPOSITORY_PORT`
  es privado de `ComunicacionesModule`, que solo exporta `DespacharEmailService` y
  `ENVIAR_EMAIL_PORT`). El alta ya depende de ese servicio para `finalizarEnvio`.
- **Alternativa descartada (Opción B)**: inyectar en `deps` del alta un puerto propio cableado
  a `new ComunicacionRepositoryPrismaAdapter(prisma)`. Rechazada por acoplar el módulo de
  reservas al adapter Prisma de comunicaciones y exportar/duplicar tokens.
- **Requiere OK humano**: confirmar Opción A (reutilizar el motor) frente a B (puerto propio).

### D-2: Un único helper de render garantiza paridad exacta con el auto-envío

El cálculo de `tipoE1` (sin_fecha / fecha_disponible=2b / fecha_cola=2d / fecha_confirmada=2a
degradada), la lectura de `fechasAlternativas` (solo `fecha_confirmada`), la selección de
plantilla `catalogo.seleccionar('E1', idioma).render(...)` y el fallback mínimo se **extraen a
un método privado `renderizarE1(comando, resultado): Promise<{ asunto, cuerpo }>`**. Ambas
ramas (auto-envío y borrador-con-comentarios) consumen ese mismo helper, de modo que el
`cuerpo`/`asunto` que se **persiste** en el borrador es idéntico —por construcción— al que se
**envía** en el auto-envío para el mismo alta. Se persiste exactamente `rendered.asunto` (no
el placeholder) y `rendered.cuerpoHtml`.

- **Requiere OK humano**: confirmar que se persiste **asunto + cuerpo** renderizados (no solo
  el cuerpo), reemplazando el `ASUNTO_E1_PLACEHOLDER`.

### D-3: El UPDATE del borrador es best-effort post-commit; no tumba el 201

El UPDATE ocurre **fuera de la unidad de trabajo** (post-commit), igual que el envío del
auto-E1. Se envuelve en `try/catch` y **no propaga**: si el UPDATE falla, el alta ya commiteó
y responde `201`; el borrador queda con el cuerpo vacío (degradado pero editable) y la reserva
existe. Es la misma política de tolerancia que el fallo de email del auto-envío (un efecto
post-commit no debe tumbar el alta ya confirmada). Guarda de idempotencia: el UPDATE es sobre
fila existente por PK (`idComunicacion`) + `tenant_id` (RLS) + `estado = 'borrador'`;
reejecutar da el mismo resultado, sin INSERT ni riesgo de duplicado.

### D-4: Sin cambio de contrato ni de frontend

`Comunicacion.cuerpo` (nullable) ya está en `docs/api-spec.yml`; `ComunicacionListItem` lo
hereda vía `allOf` y el adapter de listado ya selecciona y mapea `cuerpo`. El diálogo
`RevisarEnviarBorradorDialog` ya precarga `cuerpo`. El fix solo cambia el **valor persistido**
de una fila existente; ni la forma de respuesta ni los tipos cambian. **El paso de contrato
es N/A** (verificar, no modificar) y **no hay cambios de frontend**.

## Riesgos y mitigaciones

- **Divergencia con el auto-envío**: mitigada por D-2 (mismo helper). QA verifica paridad
  carácter a carácter (mismo comando con/sin comentarios → mismo cuerpo).
- **Guard del UPDATE**: el UPDATE debe afectar solo a filas `borrador`. Se restringe en el
  `where` (`estado = 'borrador'`) del adapter; QA de integración verifica que sobre `enviado`
  no muta, y que otro tenant no la actualiza (RLS). (Memoria: "US-049 backend nunca probado
  contra BD real" — exigir integración SQL real, no solo mocks.)
- **Regresión del auto-envío**: al extraer el helper, la rama de auto-envío debe seguir
  enviando exactamente igual (incluido el dossier). Cubierto por los tests existentes del alta
  + los nuevos de paridad.

## Decisiones cerradas (sin ambigüedad)

- El borrador permanece en `estado = 'borrador'` sin `fecha_envio`: el fix **no envía** nada,
  solo rellena `asunto` + `cuerpo`.
- El dossier **no** se adjunta al borrador (no hay envío); se adjunta al enviarlo por US-046 /
  US-047 D-2. Este fix solo toca `asunto` + `cuerpo`.
- El puerto nuevo `actualizarBorrador` es **opcional** en `AltaConsultaDeps` para no romper los
  montajes de test existentes; si falta en la rama con comentarios, degrada sin efecto.
