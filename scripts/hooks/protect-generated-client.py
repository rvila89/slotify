#!/usr/bin/env python3
"""El cliente HTTP del frontend se GENERA desde el contrato OpenAPI; nunca se edita
a mano. Bloquea Edit/Write directo sobre apps/web/src/api-client/**.
"""
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from _util import load, target_path, block, ok  # noqa: E402

data = load()
path = target_path(data)

if "apps/web/src/api-client/" in path:
    block(
        f"BLOQUEADO: edición manual del cliente generado ({path}).\n"
        "Este cliente se regenera con `pnpm generate:api` desde docs/api-spec.yml. "
        "Si está desfasado, evoluciona el contrato con el agente contract-engineer y "
        "regenera; no lo edites a mano. Ver skill contract-sync."
    )
ok()
