---
description: Ejecuta el extractor determinista del backlog (scripts/extract_backlog.py) y reporta el grafo. Produce user-stories/_analisis.json
allowed-tools: Bash, Read, Edit
---

## MODO
Tarea **mecánica**. La extracción la hace un script determinista ya escrito (`scripts/extract_backlog.py`). **No deliberes y NO leas las historias en tu contexto.** Ejecuta el script, valida la salida y reporta.

## PASOS

### 1. Ejecuta el extractor
```bash
python3 scripts/extract_backlog.py
```
El script lee `user-stories/US-*.md`, extrae los campos, construye el grafo (fan-out transitivo, ciclos, profundidad) y escribe `user-stories/_analisis.json`. Imprime un resumen y devuelve código de salida 1 si hay ciclos o dependencias rotas.

### 2. Valida (sin leer las historias completas)
Mira el resumen impreso y el campo `grafo.anomalias_extraccion` del JSON:
- **Pocas o cero anomalías** → has terminado.
- **Muchas anomalías** (p. ej. >5 historias sin Prioridad, o `area` casi siempre vacía) → la plantilla difiere de lo que asume el regex. Solo entonces: abre **UNA** historia de muestra (`Read` de un único fichero) para ver el formato real de las etiquetas, **edita el regex en `scripts/extract_backlog.py`** (es un fichero real, edítalo directamente) y vuelve a ejecutar el script. No abras más de una historia.

### 3. Reporta en el chat (breve)
- Nº de historias, ciclos (o "ninguno"), dependencias rotas, huérfanos, profundidad máxima, nº de anomalías y las 5 de mayor fan-out.
- Comprueba y comenta si `US-000A` está entre las de mayor fan-out (debería: toda pantalla autenticada cuelga de ella).
- **No vuelques el JSON completo**; ya está en `user-stories/_analisis.json`.

## NOTAS
- Requiere `python3` (solo librería estándar, sin instalaciones).
- `user-stories/_analisis.json` es el único insumo de `/ordenar-backlog`.
- Si quieres usarlo como verificación en CI/pre-commit más adelante: el script sale con código 1 cuando el grafo no está limpio.