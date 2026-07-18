# Spec Delta — Capability `comunicaciones`

> **fix-borrador-e1-cuerpo-prerelleno / UC-35 / UC-36** — Corrige el comportamiento del
> borrador E1 creado cuando el alta incluye comentarios: el borrador debe nacer con `asunto` y
> `cuerpo` renderizados (mismo idioma y misma casuística de fecha que el E1 automático), no con
> el cuerpo vacío. Reutiliza el catálogo de plantillas y el render por `tipoE1` de US-045; NO
> reimplementa el transporte de email, el bloqueo atómico de fecha ni la máquina de estados de
> la RESERVA.
>
> Fuente: fix sobre `US-045 §Happy Path E1`, `§E1 con notas/comentarios`; `US-047`; UC-35;
> UC-36; `er-diagram §3.17 COMUNICACION`, `§3.6 RESERVA`; spec viva `comunicaciones` ("Cableado
> real de E1 … dossier adjunto", "Confirmación de envío de un borrador con edición opcional de
> asunto y cuerpo").

## MODIFIED Requirements

### Requirement: Cableado real de E1 personalizado por idioma, situación de fecha y dossier adjunto

El sistema SHALL (DEBE) enviar E1 al crear una consulta usando el **catálogo de
plantillas** con la variante correcta según el idioma del lead (`RESERVA.idioma`) y
la situación de la fecha (`tipoE1`), y adjuntando siempre el **dossier PDF** del
espacio en el idioma del lead. Las 4 variantes de `tipoE1` son:

- `sin_fecha` — alta sin `fecha_evento` (sub-estado `2a`)
- `fecha_disponible` — fecha libre (sub-estado `2b`)
- `fecha_cola` — fecha en cola de consulta (sub-estado `2d`)
- `fecha_confirmada` — fecha ocupada por reserva confirmada (sub-estado `2a`
  degradada); el sistema DEBE intentar obtener fechas adyacentes libres (±1 día,
  solo fin de semana) para incluirlas en el cuerpo

El dossier se adjunta por referencia de URL (`Dossier-Masia-Encis-{idioma}.pdf`)
desde el almacén del tenant. El envío del dossier es obligatorio; si el fichero
no está disponible en el almacén, Resend falla la descarga y la COMUNICACION queda
en `estado = 'fallido'`.

Si el catálogo no puede renderizar la plantilla (idioma no soportado o error de
configuración), el sistema NO DEBE bloquear el alta: degrada a asunto/cuerpo mínimo
y envía igualmente — el motor centraliza el resultado (`enviado` o `fallido`). En
producción el catálogo siempre está inyectado y el camino real usa el render
personalizado.

Si el alta **incluye** `comentarios`, el sistema DEBE crear la COMUNICACION con
`estado = 'borrador'`, sin enviar, y DEBE **rellenarla con el `asunto` y el `cuerpo`
renderizados** por el catálogo con **paridad exacta al E1 automático**: la misma
variante `tipoE1` (según el sub-estado resultante del alta, incluyendo las fechas
alternativas en `fecha_confirmada`) y el mismo idioma (`RESERVA.idioma`, en su ausencia
`'es'`). El `asunto` renderizado reemplaza al placeholder y el `cuerpo` deja de estar
vacío, de modo que el gestor parte del E1 ya redactado, lo edita si quiere y lo envía por
la revisión de borradores (UC-36 / US-046), que adjunta el dossier según el idioma. El
borrador permanece en `estado = 'borrador'` **sin** `fecha_envio` mientras no se envíe. Si
el catálogo no está disponible, el borrador se rellena con el asunto/cuerpo mínimo de
fallback (nunca peor que hoy). El relleno del borrador es un efecto **post-commit
best-effort**: si falla, el alta responde `201` igualmente y el borrador queda editable.
(Fuente: fix sobre `US-045 §Happy Path E1`, `§E1 con notas/comentarios`; `US-047`;
`design.md §6`; decisión de producto post-US-003/004.)

#### Scenario: Alta sin comentarios auto-envía E1 personalizado con dossier

- **GIVEN** un alta de consulta válida sin comentarios, con `idioma = 'ca'`
- **WHEN** el sistema procesa el alta y dispara E1
- **THEN** envía el email con la variante correcta en catalán vía el transporte real
- **AND** adjunta `Dossier-Masia-Encis-ca.pdf` al email
- **AND** registra `COMUNICACION` con `codigo_email = 'E1'`, `estado = 'enviado'` y
  `fecha_envio` no nulo

#### Scenario: Alta con comentarios deja E1 en borrador ya redactado sin enviar

- **GIVEN** un alta de consulta válida con comentarios, con `idioma = 'ca'` y una situación
  de fecha que resuelve una variante `tipoE1` (p. ej. `sin_fecha`)
- **WHEN** el sistema procesa el alta
- **THEN** crea `COMUNICACION` con `codigo_email = 'E1'`, `estado = 'borrador'` y sin
  `fecha_envio`
- **AND** no envía el email
- **AND** la `COMUNICACION` tiene el `asunto` y el `cuerpo` renderizados por el catálogo en
  catalán y en la variante `tipoE1` correspondiente (no vacíos), idénticos a los que enviaría
  el auto-envío para el mismo alta

#### Scenario: El cuerpo del borrador con comentarios coincide con el del auto-envío

- **GIVEN** dos altas equivalentes (mismos datos, idioma y situación de fecha), una con
  comentarios y otra sin comentarios
- **WHEN** el sistema procesa ambas
- **THEN** el `cuerpo` persistido en el borrador de la primera coincide con el `cuerpo`
  enviado en el auto-envío de la segunda

#### Scenario: Catálogo no disponible envía E1 con texto mínimo sin bloquear el alta

- **GIVEN** un alta sin comentarios en un contexto donde el catálogo no puede renderizar
- **WHEN** el sistema procesa el alta
- **THEN** la RESERVA se crea correctamente
- **AND** la COMUNICACION E1 se envía con asunto/cuerpo mínimo de fallback
- **AND** el alta devuelve 201 sin error
