#!/usr/bin/env python3
"""Enforcement TDD: no se implementa lógica de dominio/casos de uso sin un test
hermano. Bloquea Edit/Write sobre ficheros de lógica crítica del backend
(domain/, application/, *.use-case.ts, *.entity.ts, maquina-estados.ts) si no
existe un fichero de test correspondiente.

Excluye scaffolding (módulos, main.ts, DTOs, controladores, prisma) para no
frenar US-000 ni el andamiaje.
"""
import os
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from _util import load, target_path, ok, block  # noqa: E402

data = load()
path = target_path(data)

# Solo aplica a lógica crítica del backend.
is_critical = (
    "apps/api" in path
    and path.endswith(".ts")
    and not path.endswith((".spec.ts", ".test.ts", ".dto.ts", ".module.ts"))
    and ("/domain/" in path or "/application/" in path
         or path.endswith((".use-case.ts", ".entity.ts"))
         or "maquina-estados" in path)
)
if not is_critical:
    ok()

base = os.path.basename(path).rsplit(".ts", 1)[0]
dir_ = os.path.dirname(path)
# Candidatos de test: hermano en la misma carpeta o en apps/api/test/**
candidates = [
    os.path.join(dir_, base + ".spec.ts"),
    os.path.join(dir_, base + ".test.ts"),
]
# Búsqueda amplia por nombre en el árbol de tests del backend.
def exists_in_tests(name):
    for root in ("apps/api/test", "apps/api/src"):
        if not os.path.isdir(root):
            continue
        for dp, _dn, fn in os.walk(root):
            for f in fn:
                if f in (name + ".spec.ts", name + ".test.ts"):
                    return True
    return False

if any(os.path.exists(c) for c in candidates) or exists_in_tests(base):
    ok()

block(
    f"TDD bloqueado: vas a implementar lógica crítica sin test ({path}).\n"
    f"Escribe primero el test (p.ej. {base}.spec.ts) con el agente tdd-engineer, "
    "verifica que falla (RED) y luego implementa (GREEN). "
    "El núcleo (bloqueo atómico, máquina de estados, tarifas) es TDD obligatorio. "
    "Ver skill tdd-core."
)
