#!/usr/bin/env python3
"""Guardrail del bloqueo atómico de fecha.

El bloqueo de fecha en Slotify es UNIQUE(tenant_id, fecha) + SELECT ... FOR UPDATE
vía Prisma $transaction, encapsulado en bloquearFecha()/liberarFecha().
PROHIBIDO introducir Redis / Redlock / locks distribuidos.
"""
import re
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from _util import load, target_path, edited_text, block, ok  # noqa: E402

data = load()
path = target_path(data)
if "apps/api" not in path:
    ok()

text = edited_text(data).lower()
FORBIDDEN = [
    (r"\bredlock\b", "Redlock"),
    (r"\bioredis\b", "ioredis"),
    (r"""from ['"]redis['"]""", "cliente redis"),
    (r"\bsetnx\b", "lock por SETNX"),
    (r"distributed[\s_-]?lock", "distributed lock"),
]
for pattern, why in FORBIDDEN:
    if re.search(pattern, text):
        block(
            f"GUARDRAIL BLOQUEO ATÓMICO bloqueado: detectado {why}.\n"
            f"Fichero: {path}\n"
            "El bloqueo de fecha NO usa Redis ni locks distribuidos. Usa "
            "UNIQUE(tenant_id, fecha) + SELECT ... FOR UPDATE en $transaction, vía "
            "bloquearFecha()/liberarFecha(). Ver skill atomic-date-lock."
        )
ok()
