---
name: state-machine
description: Usar cuando se implemente o modifique una transición de estado de la reserva, para mantener la máquina de estados como estructura de datos declarativa.
---

# Máquina de estados de la reserva

## Cuándo usar
Al añadir, cambiar o validar cualquier transición de estado/sub-estado de `Reserva`.

## Reglas
- Estados principales: `consulta` → `pre_reserva` → `reserva_confirmada` → `evento_en_curso` → `post_evento` → `reserva_completada`.
- Sub-estados de consulta: `2a` (exploratoria), `2b` (con fecha), `2c` (pendiente invitados), `2d` (cola), `2v` (visita), `2x`/`2y`/`2z` (terminales).
- Las transiciones permitidas y sus guardas se modelan como ESTRUCTURA DE DATOS (tabla declarativa `TRANSICIONES`), no como if/else dispersos.
- UNA sola función `puedeTransicionar(origen, destino, contexto)` consulta la tabla y evalúa la guarda.
- Transición inválida o guarda no satisfecha → HTTP **422**.
- Hay 16+ transiciones; toda nueva transición se añade a `TRANSICIONES`, no como caso especial en código.

## Patrón de referencia
```ts
const TRANSICIONES: Transicion[] = [
  { de: 'consulta:2b', a: 'pre_reserva', guarda: (c) => !!c.fecha },
  { de: 'pre_reserva', a: 'reserva_confirmada', guarda: (c) => c.fechaBloqueada },
  // ... 16+
];

function puedeTransicionar(de: Estado, a: Estado, ctx: Ctx): boolean {
  const t = TRANSICIONES.find((x) => x.de === de && x.a === a);
  return !!t && t.guarda(ctx);
}
```

## Errores comunes / Anti-patrones
- `switch`/`if` anidados por estado repartidos en varios casos de uso.
- Mutar `reserva.estado` sin pasar por `puedeTransicionar`.
- Devolver 400/500 ante transición inválida en vez de 422.
- Definir guardas como comentarios en lugar de código en la tabla.

## Fuentes
- docs/architecture.md
- CLAUDE.md
