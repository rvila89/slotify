# Informe de code-review — chore/harness-review-gates (bf22509)

- Fecha: 2026-06-19
- Rama: `chore/harness-review-gates` vs `master` (1 commit)
- Naturaleza: TOOLING del harness (gates de revisión humana + hook bloqueante). Los guardrails de arquitectura (hexagonal/Prisma/tenant) NO aplican.
- Alcance: corrección del hook, consistencia documental cruzada, validez de formato (JSON/YAML), riesgos de bloqueo.

## Resumen
El cambio añade dos gates de revisión humana (tras SDD y antes de archive/PR) y hace obligatorio el `code-reviewer`, reforzado por un hook PreToolUse/Bash (`require-code-review.py`) que bloquea `openspec archive` y `gh pr create|merge` sin informe `Veredicto: APTO`. El diseño es sólido y "fail-open" en los casos ambiguos. La lógica de exit 0/2 y el parseo del veredicto (anti falso positivo de "NO APTO") son correctos. Los hallazgos son menores; ninguno es bloqueante.

## Validaciones de formato
- `.claude/settings.json`: JSON válido. Hook registrado bajo `PreToolUse` con matcher `"Bash"`. Correcto.
- `openspec/config.yaml`: inspección manual (no había PyYAML en el entorno) — indentación y estructura consistentes con el resto del fichero; claves nuevas (`human_review`, `agent_must_execute`, `report`, `quality_gates.pre_archive`) bien anidadas. Sin tabs ni problemas de comillas aparentes. Apto.
- `scripts/hooks/require-code-review.py` y `_util.py`: `py_compile` OK.

## Corrección del hook (require-code-review.py)
- Exit 0/2: correcto. Usa `ok()`/`block()` de `_util.py` (exit 0 permite, exit 2 bloquea con stderr al modelo). `load()` hace fail-open si no hay JSON válido. Bien.
- Parseo del veredicto: `re.search(r"Veredicto:\s*(NO\s+APTO|APTO)", ...)` con alternativa `NO\s+APTO` PRIMERO evita el falso positivo de que "NO APTO" contenga "APTO". Verificado: `Veredicto: NO APTO` -> "NO APTO". Correcto.
- Distinción de tres estados (None = sin informe, "" = informe sin línea de veredicto, "APTO"/"NO APTO"): buen diseño, mensajes de error claros y accionables.
- Parseo del nombre del change en `openspec archive <change>`: toma el primer token no-flag tras `archive`; verificado que `openspec archive --yes mi-change` -> `mi-change`. Si no hay token o el dir no existe -> `ok()` (fail-open). Razonable.
- Fallback de `gh pr create|merge`: como el PR no nombra el change, exige APTO para CADA change activo. Tiene sentido y es conservador.

## Hallazgos

### Media — Falso positivo de `is_archive` por substring (require-code-review.py:75)
`is_archive = "openspec archive" in cmd` hace match dentro de strings/comentarios/heredocs. Verificado: `echo "to do: openspec archive foo"` activa el gate. Como la rama `gh pr` usa además regex con `\b`, conviene homogeneizar. En la práctica el impacto es bajo (fail-open si no extrae change/dir válido), pero un `echo`/comentario que contenga `openspec archive mi-change-real` con un change activo SÍ bloquearía un comando inofensivo.
Recomendación: usar un patrón anclado a token, p.ej. `re.search(r"(^|[;&|]|\s)openspec\s+archive\b", cmd)`, coherente con el `\bgh\s+pr\b` ya usado.

### Media — `gh pr create|merge` bloquea aunque el PR no tenga que ver con OpenSpec (require-code-review.py:113-121)
El fallback exige APTO para TODOS los changes activos en cualquier `gh pr create|merge`, incluida esta misma rama de tooling (que no es un change OpenSpec). Si en el futuro existe un change activo a medias y alguien abre un PR no relacionado, queda bloqueado. Es intencional (conservador) pero puede sorprender.
Recomendación: documentar el escape (renuncia explícita / mover el change a archive / o saltar el hook puntualmente) y/o limitar el fallback a changes cuyo branch coincida con el actual.

### Baja — Múltiples changes activos comparten un PR/archivo (require-code-review.py:113)
Con varios changes activos, `gh pr create` exige APTO para todos. Si el flujo real es "un change por PR", un change vecino sin review bloquea el PR del actual. Aceptable dado que el harness asume un change en vuelo, pero merece una nota.

### Baja — `archive`/`code-review` no declaran `agent_must_execute` de forma uniforme (config.yaml)
`code-review` lleva `agent_must_execute: true`; `archive` y los gates humanos no llevan flags de ejecución (correcto, son human_review). Solo conviene revisar que el consumidor de `config.yaml` no exija un campo obligatorio ausente. No se observa esquema que lo fuerce.

### Baja — Convención de nombre de report inconsistente con el resto de steps (config.yaml / docs)
El nuevo report es `YYYY-MM-DD-step-review-code-review.md` (token `step-review`), mientras el resto usa `step-N+1`, `step-N+2`... El hook solo exige substring `code-review` en el nombre, así que funciona; pero la familia de nombres rompe el patrón `step-N+k`. Cosmético.

## Consistencia documental cruzada
Coherente entre las seis fuentes:
- `config.yaml`: pasos `review-gate-sdd`, `code-review`, `review-gate-final`, `archive` + `quality_gates.pre_archive`.
- `harness-orchestrator.md`: PARADA 1 (tras SDD) y PARADA 2 (antes de archive), code-review como gate duro con informe APTO.
- `spec-author.md`: gate SDD, code-review obligatorio, gate final; archivado condicionado a APTO + hook.
- `openspec-propose/SKILL.md`: ambos gates y el code-review en la lista de pasos de `tasks.md`.
- `CLAUDE.md`: flujo diario actualizado con los dos ⏸ gates y el hook `require-code-review`.
- `docs/openspec-tasks-mandatory-steps.md`: secciones dedicadas a ambos gates, convención de veredicto y enforcement por hook.
La línea literal `Veredicto: APTO`/`NO APTO` y la ubicación `openspec/changes/<change>/reports/` se describen de forma idéntica en hook, config y docs. Sin contradicciones detectadas.

Observación menor (Baja): `docs/openspec-tasks-mandatory-steps.md` mantiene referencias antiguas a `specs/<change-name>/reports/` (plantillas heredadas de Step N+1), mientras las secciones nuevas y el hook usan `openspec/changes/<change>/reports/`. No es introducido por este diff, pero conviven dos rutas en el mismo fichero.

## Riesgos
- Bloqueo legítimo: cubierto arriba (substring `openspec archive`, fallback de PR amplio). Severidad media/baja; el diseño fail-open mitiga la mayoría.
- El hook depende de `_util.py` por ruta relativa (`sys.path.insert`); correcto porque se invoca con `$CLAUDE_PROJECT_DIR`.
- No introduce secretos ni toca código de negocio.

## Veredicto
Cambio de tooling correcto, seguro y coherente. Hallazgos solo de severidad Media/Baja (robustez del matcher y alcance del fallback de PR), ninguno bloqueante. Apto para merge; se recomienda endurecer el matcher de `openspec archive` en un follow-up.

Veredicto: APTO
