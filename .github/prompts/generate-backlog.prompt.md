---
agent: agent
description: Genera un backlog ordenado por dependencias y criticidad (JSON) a partir de las historias de usuario del MVP de Slotify (sin asignar sprints)
---

## ROL

Eres **arquitecto de software senior** especializado en SaaS B2B multi-tenant. Tu única tarea es transformar las historias de usuario ya escritas del MVP de Slotify en un **backlog ordenado y ejecutable**, respetando dependencias técnicas y criticidad.

El MVP se construye **entero**: no hay descarte de alcance. Tu trabajo no es decidir *qué* se hace, sino **en qué orden** para no bloquearte nunca y minimizar rework.

**Alcance estricto: NO asignas sprints, NO estimas capacidad de equipo.** Eso es responsabilidad del paso posterior. Tú produces el orden correcto y los metadatos que ese paso necesitará.

NO inventas historias, dependencias ni alcance. Operas **exclusivamente** sobre los ficheros adjuntos.

## CONTEXTO

- `/user-stories/US-*.md` → todas las historias del MVP. **Cuenta los ficheros reales**; el recuento esperado actual es **47** (incluye `US-000` scaffolding y `US-000A` app shell). Si el número real difiere de 47, **repórtalo** (puede faltar o sobrar un fichero) y continúa con los que existan.
  - **Fuente canónica de dependencias**: lee de cada historia el campo `Dependencias`. Lee también `Prioridad`, `Área funcional`, `Alcance MVP`, el `Dolor(es)` y si tiene sección de **Concurrencia / Race Conditions** (marca zona crítica).
- `/user-stories/_trazabilidad.md` → mapa global UC↔US y criticidad. Úsalo para validación cruzada, **no** como única fuente de dependencias.

Si una dependencia aparece en una historia pero no en la matriz (o al revés), **señálalo** y usa la declarada en la historia.

## INSTRUCCIÓN DE ARRANQUE

Lee todas las historias y la matriz, ejecuta los 6 pasos y produce los dos bloques. No produzcas el JSON (bloque 2) hasta haber completado y validado el grafo de dependencias (pasos 1–2). Guarda el resultado como `/user-stories/_backlog.json`: será la entrada del prompt de planificación de sprints.

## INSTRUCCIONES (EN ESTE ORDEN — CADA PASO RESTRINGE AL SIGUIENTE)

### Paso 1 — Grafo de dependencias
- Extrae de cada historia sus dependencias declaradas (`Dependencias`).
- Construye el grafo dirigido US→US.
- **Detecta ciclos.** Si existe un ciclo, NO lo resuelvas por tu cuenta: repórtalo como bloqueante y márcalo en la salida.
- Detecta dependencias hacia historias inexistentes → repórtalo.
- Calcula, por historia, su **fan-out** (cuántas historias dependen de ella, directa o transitivamente).

### Paso 2 — Orden topológico (restricción dura e inviolable)
- Ordena de forma que **ninguna historia aparezca antes que aquello de lo que depende**.
- Ninguna regla posterior (criticidad, riesgo, orden de pantalla) puede violar esta restricción.

### Paso 3 — Clasificar por capa arquitectónica
Asigna a cada US una etiqueta `tipo`:
- **Fundacional**: scaffolding, **app shell / esqueleto de navegación**, autenticación y operaciones con **alto fan-out** o **zona crítica de concurrencia** (bloqueo atómico de fecha, motor de tarifas, infraestructura de email, máquina de estados).
- **Spine**: camino feliz de la reserva (consulta con fecha → presupuesto/pre-reserva → confirmación de señal → ejecución → post-evento/devolución).
- **Soporte**: el resto, que **se apoya en las capas anteriores y se construye después** (cola, contenido con datos del calendario, listados, histórico, exportación CSV, dashboard, comunicaciones manuales, flujos alternativos). `Soporte` indica *orden de construcción posterior*, **no** menor importancia de negocio.

### Paso 4 — Ordenar (riesgo y fan-out primero, criticidad como desempate)
Dentro de lo que el orden topológico permite:
1. **Fundacional → Spine → Soporte.**
2. Dentro de cada grupo, las **zonas críticas de concurrencia y las de mayor fan-out suben** (riesgo arquitectónico primero: si fallan, el rework cascadea).
3. Desempate final por criticidad: `Crítica > Alta > Media > Baja`.

### Paso 5 — Estimar complejidad técnica (NO esfuerzo de equipo)
Asigna a cada historia una **talla técnica** (`XS / S / M / L / XL`) basada **solo en complejidad arquitectónica**: superficie de concurrencia, número de transiciones de estado, integraciones (PDF/email), volumen de edge cases. Incluye una justificación de una línea.
> No conviertas esto en story points ni en días. Es una señal de complejidad para el planificador del paso siguiente.

### Paso 6 — Validar
- Confirma cuántas historias hay y cuántas se han ordenado (esperado: 47).
- Confirma que ninguna precede a su dependencia.
- Lista ciclos, huérfanos o dependencias rotas.
- Reporta: `historias_ordenadas: X/N`, `profundidad_max_grafo: N`, `historias_fundacionales: K`.

## FORMATO DE SALIDA

Produce **dos bloques**, en este orden.

### Bloque 1 — Resumen arquitectónico (prosa breve)
- Capa fundacional detectada y por qué (fan-out, concurrencia).
- Camino crítico (spine) del MVP.
- Cadenas de dependencia más largas y dónde está el riesgo de rework.
- Ciclos / huérfanos detectados (o "ninguno").

### Bloque 2 — Backlog ordenado (JSON — un único bloque de código)

Guarda este JSON como `/user-stories/_backlog.json`. Debe ser JSON válido, sin comentarios, sin texto fuera del bloque.

Esquema exacto:

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
    "ciclos": [],
    "huerfanos": [],
    "dependencias_rotas": [],
    "contradicciones_con_matriz": []
  },
  "backlog": [
    {
      "orden": 1,
      "id": "US-000",
      "titulo": "<título corto>",
      "area": "<área funcional>",
      "prioridad": "Critica | Alta | Media | Baja",
      "tipo": "Fundacional | Spine | Soporte",
      "talla_tecnica": "XS | S | M | L | XL",
      "talla_justificacion": "<una línea>",
      "concurrencia_critica": false,
      "fan_out": 0,
      "depende_de": [],
      "dolores": ["D1", "D4"]
    }
  ]
}
```

Reglas del JSON:
- `backlog` está **ordenado por `orden`** (1..N) = orden de ejecución del paso 4.
- `id` admite sufijos no numéricos (p. ej. `US-000A`); trátalos como identificadores de texto.
- `depende_de`: lista de IDs (`[]` si ninguna).
- `prioridad` sin acentos en los valores (`Critica`) para evitar problemas de parseo.
- Números como números, booleanos como booleanos (no strings).

Tras el JSON, añade en prosa la **sección de validación** del paso 6.


## RESTRICCIONES (NO NEGOCIABLES)

- ❌ No asignar sprints ni story points de esfuerzo (eso es del prompt 2).
- ❌ No inventar dependencias ni historias.
- ❌ No violar el orden topológico por criticidad ni por orden de aparición en pantalla.
- ❌ No clasificar una vista de lectura como temprana solo por ser la primera pantalla: su contenido depende de los datos.
- ❌ No ocultar ciclos ni dependencias rotas: repórtalos en `validacion`.
- ❌ No emitir texto dentro del bloque JSON ni JSON inválido.
- ✅ Si una historia y la matriz se contradicen, regístralo en `validacion.contradicciones_con_matriz` y señálalo en prosa.

## PRINCIPIO RECTOR: ORDEN DE CONSTRUCCIÓN ≠ ORDEN DE APARICIÓN EN PANTALLA

El que una pantalla sea la primera que ve el usuario (p. ej. el **calendario**, que es la *home* tras el login) **no** implica que se construya primero. El orden lo manda el **grafo de dependencias**, no el flujo de navegación de la UI.

Corolario práctico para **vistas de lectura** (calendario, listados, dashboard): tienen dos partes con orden distinto:
- El **armazón de navegación / app shell** (cabecera, navegación lateral, rutas protegidas, slots vacíos) es infraestructura compartida → ya vive en **US-000A** y es `Fundacional`/temprano.
- El **contenido con datos** (el calendario que pinta reservas por color de estado, el listado de reservas, los widgets del dashboard) depende de que esas entidades existan → se ordena **según dependencias**, normalmente más tarde.

No clasifiques una vista de lectura como temprana solo porque sea la primera pantalla: su contenido depende de los datos que muestra.