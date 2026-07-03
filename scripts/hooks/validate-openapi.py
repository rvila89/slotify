#!/usr/bin/env python3
"""PostToolUse sobre docs/api-spec.yml: valida el contrato tras editarlo.

Usa spectral/redocly si están instalados; si no, valida que el YAML cargue y
tenga la forma OpenAPI mínima. Señala (exit 2) si el contrato queda inválido para
que el contract-engineer lo corrija y recuerde regenerar el SDK.
"""
import shutil
import subprocess
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from _util import load, target_path, block, ok  # noqa: E402

data = load()
path = target_path(data)
if not path.endswith("api-spec.yml"):
    ok()

# 1) Linters reales si existen.
for linter, args in (("spectral", ["lint", path]), ("redocly", ["lint", path])):
    if shutil.which(linter):
        r = subprocess.run([linter, *args], capture_output=True, text=True)
        if r.returncode != 0:
            block(
                f"VALIDACIÓN OPENAPI fallida ({linter}):\n{r.stdout}\n{r.stderr}\n"
                "Corrige el contrato antes de congelarlo. Recuerda regenerar el SDK "
                "(`pnpm generate:api`) tras el cambio. Ver skill openapi-governance."
            )
        ok(f"OpenAPI válido según {linter}. Recuerda: regenerar SDK si cambió el contrato.")

# 2) Fallback: YAML básico + claves OpenAPI.
try:
    import yaml  # type: ignore
    with open(path, encoding="utf-8") as fh:
        spec = yaml.safe_load(fh)
    if not isinstance(spec, dict) or "openapi" not in spec or "paths" not in spec:
        block("OpenAPI inválido: faltan claves 'openapi' o 'paths'.")
    ok("OpenAPI: YAML válido (sin linter instalado). Recuerda regenerar el SDK.")
except ImportError:
    ok("Editado api-spec.yml. Instala spectral/redocly o PyYAML para validación automática; "
       "recuerda regenerar el SDK con `pnpm generate:api`.")
except Exception as e:  # noqa: BLE001
    block(f"OpenAPI inválido: el YAML no carga ({e}).")
