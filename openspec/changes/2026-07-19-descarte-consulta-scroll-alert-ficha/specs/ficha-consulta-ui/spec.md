# Spec Delta — Capability `ficha-consulta-ui`

> Abre la capability frontend de la **Ficha de consulta** con la conducta de
> confirmación al descartar una consulta: desplazamiento al inicio de la página
> (el "puntero" sube) + alert de éxito. Cambio SOLO frontend (`apps/web`); la
> transición de dominio US-013 (`2a/2b/2c/2d/2v → 2z`) no se toca. Fuente:
> petición de usuario; patrón scroll `NuevaConsultaPage`; toast
> `DescartarConsultaDialog`.

## ADDED Requirements

### Requirement: Confirmación de descarte en la ficha — desplazamiento al inicio y alert de éxito

El sistema SHALL (DEBE), cuando el Gestor confirma el descarte de una consulta
desde la **Ficha de consulta** (`FichaConsultaPage`) y el backend responde con
éxito (200), realizar dos acciones de retroalimentación en la interfaz: (a)
**desplazar la vista al inicio** de la página (posición de scroll superior, vía
`window.scrollTo({ top: 0, behavior: 'smooth' })`, el mismo patrón usado en la
Nueva consulta), de modo que el foco visual vuelva a la cabecera de la consulta
donde el estado ya refleja el resultado; y (b) mostrar un **alert de éxito**
(toast) que informe de que la consulta se marcó como descartada correctamente,
incluyendo el código de la consulta. El desplazamiento y el alert SHALL (DEBEN)
producirse **únicamente** ante respuesta de éxito. Ante un error del backend (409
`transicion_no_permitida`, 422 `origen_invalido` o error genérico) el sistema NO
DEBE desplazar la vista ni mostrar alert de éxito: el error se presenta inline en
el diálogo y la vista conserva su posición. Esta conducta es de presentación
(frontend) y NO altera la transición de dominio ni sus efectos (liberación de
fecha, promoción de cola), que gobierna la capability `consultas` (US-013).
(Fuente: petición de usuario; `NuevaConsulta/NuevaConsultaPage.tsx`
`window.scrollTo`; `DescartarConsultaDialog` `toast.success`; `US-013 §Happy
Path`.)

#### Scenario: Descarte con éxito desde una ficha desplazada vuelve al inicio y avisa

- **GIVEN** el Gestor autenticado en la Ficha de consulta de una RESERVA en un
  sub-estado no terminal (p. ej. `2b`), con la página desplazada hacia abajo
  (viendo la sección de acciones)
- **WHEN** confirma el descarte en el diálogo "Marcar como descartada por
  cliente" y el backend responde 200
- **THEN** la vista se desplaza al inicio de la página (posición de scroll
  superior)
- **AND** aparece un alert de éxito (toast) indicando que la consulta se marcó
  como descartada correctamente, con el código de la consulta
- **AND** el diálogo se cierra y la ficha refleja el nuevo estado terminal

#### Scenario: Descarte que falla no desplaza ni muestra alert de éxito

- **GIVEN** el Gestor en la Ficha de consulta con la página desplazada hacia abajo
- **WHEN** confirma el descarte pero el backend responde con error (409
  `transicion_no_permitida`, 422 `origen_invalido` o genérico)
- **THEN** la vista NO se desplaza al inicio (conserva su posición de scroll)
- **AND** NO se muestra alert de éxito
- **AND** el mensaje de error se presenta inline en el diálogo, que permanece
  abierto
