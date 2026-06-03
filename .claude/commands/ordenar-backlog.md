---
description: Lee _analisis.json y produce el backlog ordenado por dependencias y criticidad en _backlog.json (sin asignar sprints)
allowed-tools: Read, Write
---

## ROL
Eres arquitecto de software senior. Esta es la **segunda pasada**. Recibes el fichero compacto `user-stories/_analisis.json` (de `/analizar-backlog`) y produces el **backlog ordenado**. NO relees las 47 historias: todo lo que necesitas está en `_analisis.json`.

**Alcance estricto:** ordenas y clasificas; **NO** asignas sprints ni estimas capacidad de equipo (eso es de un paso posterior).

## ENTRADA
- **Lee** `user-stories/_analisis.json`. Si no existe o es JSON inválido, **detente** e indica al usuario que ejecute primero `/analizar-backlog`.
- Si `grafo.ciclos` no está vacío, **detente** y repórtalo: no se puede ordenar topológicamente con ciclos.

## EFICIENCIA
El grafo ya viene **calculado de forma determinista** por el script de la pasada 1: `fan_out`, `ciclos`, `huerfanos`, `dependencias_rotas` y `profundidad_max` son fiables. **No los recalcules ni deliberes sobre ellos.** Trabajas sobre datos compactos (un JSON pequeño), así que no necesitas razonamiento intensivo: dedica tu juicio solo a lo que requiere criterio (clasificar capa, ordenar, estimar talla).

## PRINCIPIO RECTOR: ORDEN DE CONSTRUCCIÓN ≠ ORDEN DE PANTALLA
Que una pantalla sea la primera que ve el usuario (p. ej. el **calendario**, home tras login) NO implica que se construya primero. El orden lo manda el **grafo de dependencias**.
- El **armazón de navegación / app shell** (US-000A) es infraestructura compartida → `Fundacional`/temprano.
- El **contenido con datos** de una vista de lectura (calendario que pinta reservas, listados, widgets) depende de que esas entidades existan → se ordena según dependencias, normalmente más tarde. No la marques temprana solo por ser la primera pantalla.

## PASOS
1. **Orden topológico (restricción dura e inviolable):** ninguna historia puede ir antes que cualquiera de sus `depende_de`. Reconstruye la adyacencia desde `depende_de`.
2. **Clasificar `tipo`:**
   - `Fundacional`: scaffolding, app shell / navegación, autenticación, y operaciones con **alto fan_out** o **concurrencia_critica** (bloqueo atómico de fecha, motor de tarifas, infraestructura de email, máquina de estados).
   - `Spine`: camino feliz de la reserva (consulta con fecha → presupuesto/pre-reserva → confirmación de señal → ejecución → post-evento/devolución).
   - `Soporte`: el resto, que se apoya en las anteriores y se construye después (cola, contenido del calendario, listados, histórico, CSV, dashboard, comunicaciones manuales, flujos alternativos). `Soporte` = orden posterior, **no** menor importancia.
3. **Ordenar:** dentro de lo que el orden topológico permite → `Fundacional → Spine → Soporte`; dentro de cada grupo, **concurrencia y mayor fan_out suben** (riesgo primero); desempate por criticidad `Critica > Alta > Media > Baja`.
4. **Estimar `talla_tecnica`** (`XS/S/M/L/XL`) con las señales del análisis: `concurrencia_critica`, `integraciones`, `num_edge_cases`, y la posición en la máquina de estados. Solo complejidad arquitectónica; NO la conviertas en días ni story points. Una línea de justificación por historia.
5. **Validar:** todas las historias ordenadas; ninguna precede a su dependencia; reporta `historias_ordenadas: X/N`, `profundidad_max`, `historias_fundacionales: K`.
6. **Escribe** `user-stories/_backlog.json` con el esquema de abajo. Tras escribirlo, imprime en el chat solo el resumen de validación (no vuelques el JSON entero).

## ESQUEMA DE `_backlog.json`
```json
{
  "meta": {
    "proyecto": "Slotify MVP",
    "generado": "<ISO-8601>",
    "total_historias": 47,
    "ventana_codigo": { "inicio": "2026-06-12", "fin_codigo": "2026-07-10" }
  },
  "validacion": {
    "historias_ordenadas": "47/47",
    "profundidad_max_grafo": 0,
    "historias_fundacionales": 0,
    "ciclos": [], "huerfanos": [], "dependencias_rotas": []
  },
  "backlog": [
    {
      "orden": 1,
      "id": "US-000",
      "titulo": "<corto>",
      "area": "<área>",
      "prioridad": "Critica",
      "tipo": "Fundacional | Spine | Soporte",
      "talla_tecnica": "XS | S | M | L | XL",
      "talla_justificacion": "<una línea>",
      "concurrencia_critica": false,
      "fan_out": 0,
      "depende_de": [],
      "dolores": ["D1"]
    }
  ]
}
```

## RESTRICCIONES
- `backlog` ordenado por `orden` (1..N) = orden de ejecución del paso 3.
- `id` admite sufijos no numéricos (`US-000A`): trátalos como texto.
- No violar el orden topológico por criticidad ni por orden de pantalla.
- No asignar sprints ni story points de esfuerzo.
- No emitir texto dentro del bloque JSON ni JSON inválido.