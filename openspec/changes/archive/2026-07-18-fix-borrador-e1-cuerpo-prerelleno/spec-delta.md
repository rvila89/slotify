# Spec Delta — Índice (fix-borrador-e1-cuerpo-prerelleno)

> Los deltas ejecutables (los que valida `openspec validate --strict`) viven en
> `specs/<capability>/spec.md` de este change, siguiendo la convención de OpenSpec y del
> proyecto (`openspec/project.md §Cómo trabajamos`). Este archivo es solo un índice legible de
> qué requirements se modifican y en qué capability, con su identificador nemotécnico. La
> fuente de verdad para el validador son los ficheros enlazados abajo.

## `openspec/specs/comunicaciones/spec.md` → [`specs/comunicaciones/spec.md`](specs/comunicaciones/spec.md)

- **MODIFIED `R-Cableado real de E1 …`** — "Cableado real de E1 personalizado por idioma,
  situación de fecha y dossier adjunto" (requirement vivo de US-045, refinado por US-047): se
  precisa que, cuando el alta **incluye comentarios** y el E1 queda en `estado = 'borrador'`,
  la COMUNICACION nace con **`asunto` y `cuerpo` renderizados** por el catálogo con **paridad
  exacta al E1 automático** (mismo idioma `RESERVA.idioma` y misma casuística `tipoE1`,
  incluidas fechas alternativas), no con el cuerpo vacío. El borrador permanece en `borrador`
  sin `fecha_envio` y sin enviar; el gestor lo edita y lo envía por US-046 (que adjunta el
  dossier, US-047 D-2). El auto-envío sin comentarios no cambia.

  > Nota de método: se modela como **MODIFIED** del requirement vivo de E1 (mantiene su nombre
  > → una sola sección MODIFIED, sin REMOVED+ADDED). El delta reproduce el requirement completo
  > con el párrafo de "alta con comentarios" corregido y el escenario "Alta con comentarios"
  > ampliado para exigir asunto/cuerpo renderizados.
