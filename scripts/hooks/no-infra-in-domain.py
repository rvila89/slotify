#!/usr/bin/env python3
"""Guardrail hexagonal: domain/ no puede importar framework ni infraestructura.

Bloquea Edit/Write sobre apps/api/**/domain/** cuyo texto introduzca imports de
@nestjs/*, @prisma/client, prisma, o de la capa infrastructure/.
"""
import re
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from _util import load, target_path, edited_text, block, ok  # noqa: E402

data = load()
path = target_path(data)

if "/domain/" not in path or not path.startswith("apps/api") and "apps/api/" not in path:
    ok()

text = edited_text(data)
FORBIDDEN = [
    (r"""from ['"]@nestjs/""", "@nestjs/* (framework) en domain"),
    (r"""from ['"]@prisma/client""", "@prisma/client en domain"),
    (r"""from ['"][^'"]*infrastructure/""", "import de infrastructure/ en domain"),
    (r"\bPrismaService\b", "PrismaService en domain"),
]
for pattern, why in FORBIDDEN:
    if re.search(pattern, text):
        block(
            f"GUARDRAIL HEXAGONAL bloqueado: {why}.\n"
            f"Fichero: {path}\n"
            "El dominio NO importa framework ni infraestructura: depende solo de sus "
            "puertos (interfaces). Mueve la dependencia a infrastructure/ e invierte con "
            "un puerto en domain/puertos. Ver skill hexagonal-ddd."
        )
ok()
