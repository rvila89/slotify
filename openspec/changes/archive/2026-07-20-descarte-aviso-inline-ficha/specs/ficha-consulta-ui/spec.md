# Spec Delta — Capability `ficha-consulta-ui`

> Confirmación de los descartes desde la **Ficha de consulta** mediante un **aviso
> inline verde en la cabecera** (homogéneo con el resto de transiciones de la ficha) +
> desplazamiento al inicio, para pre-reserva (US-011) y consulta (US-013). Cambio SOLO
> frontend (`apps/web`); las transiciones de dominio no se tocan. Como el spec hermano
> `2026-07-19-descarte-consulta-scroll-alert-ficha` (que describía la confirmación de
> consulta como toast) aún NO está archivado, este delta ADDED define directamente la
> conducta viva (aviso inline, no toast) y la extiende a la pre-reserva. Fuente:
> petición de usuario; `AvisoVisitaProgramada.tsx` (patrón esmeralda); `US-011`;
> `US-013 §Happy Path`.

## ADDED Requirements

### Requirement: Confirmación de descarte en la ficha — aviso inline verde en cabecera y desplazamiento al inicio

El sistema SHALL (DEBE), cuando el Gestor confirma desde la **Ficha de consulta**
(`FichaConsultaPage`) el descarte de una **pre-reserva** (US-011,
`pre_reserva → reserva_cancelada`) o de una **consulta** (US-013,
`2a/2b/2c/2d/2v → 2z`) y el backend responde con éxito (200), realizar dos acciones de
retroalimentación en la interfaz: (a) **mostrar un aviso inline de éxito** en la
cabecera de la ficha (banner verde esmeralda con ícono, título en negrita y
descripción, cerrable — mismo patrón visual que los demás avisos de desenlace de la
ficha, p. ej. `AvisoVisitaProgramada`) que informe de que la pre-reserva/consulta se
marcó como descartada correctamente, **incluyendo el código** de la reserva; y (b)
**desplazar la vista al inicio** de la página (`window.scrollTo({ top: 0, behavior:
'smooth' })`, patrón vivo del proyecto), de modo que el foco visual vuelva a la
cabecera donde el estado ya refleja el resultado.

El sistema NO DEBE mostrar la confirmación de éxito como un toast lateral (Sonner
`bottom-right`); la confirmación de estos descartes es el aviso inline. El host global
`<Toaster/>` permanece montado para otros dominios, pero los diálogos de descarte de
pre-reserva y de consulta NO DEBEN emitir `toast.success`.

El aviso y el desplazamiento SHALL (DEBEN) producirse **únicamente** ante respuesta de
éxito. Ante un error del backend (409 `transicion_no_permitida`, 422 `origen_invalido`
o error genérico) el sistema NO DEBE mostrar aviso de éxito ni desplazar la vista: el
error se presenta inline en el diálogo, que permanece abierto, y la vista conserva su
posición de scroll.

Esta conducta es de presentación (frontend) y NO altera las transiciones de dominio ni
sus efectos (liberación de fecha, promoción/reordenación de cola), que gobiernan las
capabilities de dominio (US-011, US-013).

Además, la Ficha de consulta SHALL (DEBE) mostrar **como máximo un aviso de desenlace a
la vez**: cuando se produce un nuevo desenlace (cualquier transición, envío o descarte que
genere aviso), este **sustituye** al aviso anterior en lugar de acumularse. De este modo el
Gestor ve únicamente el aviso de la **última** acción realizada, evitando la confusión de
varios banners simultáneos de acciones ya pasadas. El aviso visible se oculta al cerrarlo o
al iniciar una nueva acción.

(Fuente: petición de usuario; `AvisoVisitaProgramada.tsx` `border-emerald-200
bg-emerald-50 text-emerald-900`; `NuevaConsulta/NuevaConsultaPage.tsx`
`window.scrollTo`; `US-011`; `US-013 §Happy Path`.)

#### Scenario: Descarte de pre-reserva con éxito muestra aviso verde inline y sube al inicio

- **GIVEN** el Gestor autenticado en la Ficha de consulta de una RESERVA en estado
  `pre_reserva`, con la página desplazada hacia abajo (viendo la sección de acciones)
- **WHEN** confirma el descarte en el diálogo "Descartar pre-reserva" y el backend
  responde 200
- **THEN** aparece en la cabecera de la ficha un **aviso inline verde** (esmeralda)
  indicando que la pre-reserva se descartó correctamente, con su código
- **AND** la vista se desplaza al inicio de la página (posición de scroll superior)
- **AND** NO se muestra ningún toast lateral de éxito
- **AND** el diálogo se cierra y la ficha refleja el nuevo estado terminal
- **AND** el aviso es cerrable por el usuario

#### Scenario: Descarte de consulta con éxito muestra aviso verde inline y sube al inicio

- **GIVEN** el Gestor autenticado en la Ficha de consulta de una RESERVA en un
  sub-estado de consulta no terminal (p. ej. `2b`), con la página desplazada hacia
  abajo
- **WHEN** confirma el descarte en el diálogo "Marcar como descartada por cliente" y
  el backend responde 200
- **THEN** aparece en la cabecera de la ficha un **aviso inline verde** (esmeralda)
  indicando que la consulta se marcó como descartada por el cliente, con su código
- **AND** la vista se desplaza al inicio de la página (posición de scroll superior)
- **AND** NO se muestra ningún toast lateral de éxito
- **AND** el diálogo se cierra y la ficha refleja el nuevo estado terminal
- **AND** el aviso es cerrable por el usuario

#### Scenario: Descarte que falla no muestra aviso de éxito ni desplaza

- **GIVEN** el Gestor en la Ficha de consulta (pre-reserva o consulta) con la página
  desplazada hacia abajo
- **WHEN** confirma el descarte pero el backend responde con error (409
  `transicion_no_permitida`, 422 `origen_invalido` o genérico)
- **THEN** NO se muestra el aviso inline verde de éxito
- **AND** la vista NO se desplaza al inicio (conserva su posición de scroll)
- **AND** el mensaje de error se presenta inline en el diálogo, que permanece abierto

#### Scenario: Un nuevo desenlace sustituye al aviso anterior (solo el último visible)

- **GIVEN** el Gestor en la Ficha de consulta con un aviso de desenlace ya visible en la
  cabecera (p. ej. el de una transición previa) que no ha cerrado
- **WHEN** realiza una nueva acción con éxito que genera su propio aviso (p. ej. un
  descarte)
- **THEN** se muestra **únicamente** el aviso de la última acción
- **AND** el aviso anterior deja de mostrarse (no se acumulan varios banners a la vez)
