#!/usr/bin/env python3
"""
Extractor determinista del backlog de Slotify.

Lee las historias de usuario (user-stories/US-*.md), extrae sus campos según
la plantilla fija y construye el grafo de dependencias (fan-out transitivo,
ciclos, profundidad). NO requiere un LLM: es codigo determinista.

Salida: user-stories/_analisis.json  (entrada de la fase de ordenacion)

Uso:
    python3 scripts/extract_backlog.py            # usa <repo>/user-stories
    python3 scripts/extract_backlog.py <carpeta>  # carpeta alternativa

Codigo de salida: 0 si el grafo esta limpio; 1 si hay ciclos o dependencias rotas
"""
import json, re, glob, os, sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_STORY_DIR = os.path.normpath(os.path.join(HERE, "..", "user-stories"))
STORY_DIR = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_STORY_DIR
OUT = os.path.join(STORY_DIR, "_analisis.json")

if not os.path.isdir(STORY_DIR):
    sys.exit(f"ERROR: no existe la carpeta de historias: {STORY_DIR}")


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def field(text, label):
    """Lee un campo de plantilla en una sola linea: '- Etiqueta: valor'."""
    pat = rf"^[-*]\s*{re.escape(label)}\s*[:：]\s*(.+)$"
    m = re.search(pat, text, re.MULTILINE | re.IGNORECASE)
    return m.group(1).strip() if m else None


def extract_deps(text, sid):
    """
    Extrae IDs de dependencias de forma conservadora:
    - Formato inline:    '- Dependencias: US-000, US-001'  → usa esa linea
    - Formato multilínea: '- Dependencias:\n  - US-003 / US-004 — ...'
                          → usa SOLO la primera linea de bullet
    En ambos casos toma el fragmento ANTES del guion explicativo (—).
    Esto evita capturar IDs de explicaciones y referencias hacia adelante.
    """
    ID_RE = re.compile(r"US-\d{3}[A-Z]?")

    # Intento 1: contenido en la misma linea que "Dependencias:"
    inline = re.search(
        r'^[-*]\s*Dependencias\s*[:：]\s*(.+)$',
        text, re.MULTILINE | re.IGNORECASE
    )
    if inline:
        raw = inline.group(1)
    else:
        # Intento 2: primera línea de bullet bajo "Dependencias:"
        first_bullet = re.search(
            r'^[-*]\s*Dependencias\s*[:：]\s*\n\s+[-*]\s*(.+)$',
            text, re.MULTILINE | re.IGNORECASE
        )
        raw = first_bullet.group(1) if first_bullet else ""

    # Solo el fragmento antes del guion explicativo
    fragment = re.split(r'\s+[—–]\s+|\s*—\s*', raw)[0].strip()
    ids = set(ID_RE.findall(fragment)) - {sid}
    return sorted(ids)


ID_RE = re.compile(r"US-\d{3}[A-Z]?")
PRI_MAP = {
    "crítica": "Critica", "critica": "Critica",
    "alta": "Alta", "media": "Media", "baja": "Baja"
}

stories, anomalias = {}, []

for path in sorted(glob.glob(os.path.join(STORY_DIR, "US-*.md"))):
    text = read(path)
    sid = field(text, "ID")
    if not sid:
        m = re.search(r"(US-\d{3}[A-Z]?)", os.path.basename(path))
        sid = m.group(1) if m else os.path.basename(path)
        anomalias.append(f"{os.path.basename(path)}: sin campo ID")
    mt = re.search(r"^#\s*.*Historia de Usuario\s*[:：]\s*(.+)$", text, re.MULTILINE)
    titulo = mt.group(1).strip() if mt else os.path.basename(path)
    area = field(text, "Área funcional") or field(text, "Area funcional")
    pri_raw = (field(text, "Prioridad") or "").strip()
    prioridad = PRI_MAP.get(pri_raw.lower(), pri_raw or None)
    if not prioridad:
        anomalias.append(f"{sid}: sin Prioridad")
    deps = extract_deps(text, sid)
    dol_line = field(text, "Dolor(es) que resuelve") or field(text, "Dolores") or ""
    dolores = sorted(set(re.findall(r"D\d{1,2}", dol_line)))
    concurrencia = bool(re.search(
        r"^#+.*(concurrencia|race condition)", text, re.MULTILINE | re.IGNORECASE
    ))
    integraciones = []
    if re.search(r"\bPDF\b", text, re.IGNORECASE): integraciones.append("pdf")
    if re.search(r"\bemail\b|correo electr", text, re.IGNORECASE): integraciones.append("email")
    seg = re.search(
        r"###\s*.*Flujos Alternativos.*?(?=\n##\s|\Z)", text, re.IGNORECASE | re.DOTALL
    )
    num_edge = len(re.findall(r"^####\s", seg.group(0), re.MULTILINE)) if seg else 0
    stories[sid] = {
        "id": sid, "titulo": titulo, "area": area, "prioridad": prioridad,
        "depende_de": deps, "fan_out": 0, "concurrencia_critica": concurrencia,
        "integraciones": integraciones, "num_edge_cases": num_edge, "dolores": dolores,
    }

ids = set(stories)
dependencias_rotas = sorted({d for s in stories.values() for d in s["depende_de"] if d not in ids})
for s in stories.values():
    s["depende_de"] = [d for d in s["depende_de"] if d in ids]

dependents = {i: set() for i in ids}
for i, s in stories.items():
    for d in s["depende_de"]:
        dependents[d].add(i)


def transitive(i):
    seen, stack = set(), list(dependents[i])
    while stack:
        x = stack.pop()
        if x not in seen:
            seen.add(x)
            stack.extend(dependents[x])
    return len(seen)


for i in ids:
    stories[i]["fan_out"] = transitive(i)

indeg = {i: len(stories[i]["depende_de"]) for i in ids}
q = [i for i in ids if indeg[i] == 0]
visited = 0
while q:
    n = q.pop()
    visited += 1
    for m_ in dependents[n]:
        indeg[m_] -= 1
        if indeg[m_] == 0:
            q.append(m_)
ciclos = [] if visited == len(ids) else sorted(i for i in ids if indeg[i] > 0)

prof = {}


def depth(i):
    if i not in prof:
        prof[i] = 1 + max([depth(d) for d in stories[i]["depende_de"]], default=0)
    return prof[i]


profundidad_max = 0 if ciclos else max((depth(i) for i in ids), default=0)
huerfanos = sorted(i for i in ids if not stories[i]["depende_de"] and not dependents[i])

out = {
    "meta": {
        "proyecto": "Slotify MVP",
        "generado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "total_historias": len(ids)
    },
    "grafo": {
        "ciclos": ciclos, "huerfanos": huerfanos,
        "dependencias_rotas": dependencias_rotas, "contradicciones": [],
        "profundidad_max": profundidad_max, "anomalias_extraccion": anomalias
    },
    "historias": [stories[i] for i in sorted(ids)],
}
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)

print(f"OK: {len(ids)} historias -> {OUT}")
print(f"Ciclos: {ciclos or 'ninguno'}")
print(f"Dependencias rotas: {dependencias_rotas or 'ninguna'}")
print(f"Huerfanos: {huerfanos or 'ninguno'}")
print(f"Profundidad maxima del grafo: {profundidad_max}")
print(f"Anomalias de extraccion: {len(anomalias)}")
if anomalias:
    for a in anomalias[:10]:
        print(f"  - {a}")
top = sorted(stories.values(), key=lambda s: s["fan_out"], reverse=True)[:5]
print("Top fan-out:", [(s["id"], s["fan_out"]) for s in top])
sys.exit(1 if (ciclos or dependencias_rotas) else 0)