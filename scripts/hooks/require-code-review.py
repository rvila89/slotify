#!/usr/bin/env python3
"""Gate final del harness: el code-reviewer es OBLIGATORIO antes de cerrar.

Bloquea (PreToolUse sobre Bash) los comandos que cierran un change —
`openspec archive <change>` y la creación/merge de PR (`gh pr create|merge`)—
si no existe un informe del code-reviewer con veredicto APTO en
`openspec/changes/<change>/reports/`.

Convención del informe (ver openspec/config.yaml, paso `code-review`):
  - fichero que contenga "code-review" en el nombre, bajo reports/ del change
  - una línea literal `Veredicto: APTO`  (o `Veredicto: NO APTO`)

Salida: exit 0 permite, exit 2 bloquea (stderr al modelo). Ver _util.py.
"""
import os
import re
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from _util import load, bash_command, ok, block  # noqa: E402

CHANGES_DIR = "openspec/changes"


def report_verdict(change_dir):
    """Devuelve 'APTO', 'NO APTO' o None según el informe de code-review del change."""
    reports = os.path.join(change_dir, "reports")
    if not os.path.isdir(reports):
        return None
    found_report = False
    for fn in os.listdir(reports):
        if "code-review" not in fn.lower() or not fn.endswith(".md"):
            continue
        found_report = True
        try:
            with open(os.path.join(reports, fn), encoding="utf-8") as fh:
                text = fh.read()
        except OSError:
            continue
        # Busca la línea de veredicto. "NO APTO" se comprueba primero para
        # evitar el falso positivo de que la cadena "NO APTO" contiene "APTO".
        m = re.search(r"Veredicto:\s*(NO\s+APTO|APTO)", text, re.IGNORECASE)
        if m:
            return "NO APTO" if m.group(1).upper().startswith("NO") else "APTO"
    return "" if found_report else None  # "" = informe presente pero sin línea de veredicto


def active_changes():
    if not os.path.isdir(CHANGES_DIR):
        return []
    out = []
    for name in os.listdir(CHANGES_DIR):
        p = os.path.join(CHANGES_DIR, name)
        if name == "archive" or not os.path.isdir(p):
            continue
        out.append((name, p))
    return out


def require_apto(change_name, change_dir):
    verdict = report_verdict(change_dir)
    if verdict == "APTO":
        return None
    if verdict is None:
        return (f"falta el informe del code-reviewer en {change_dir}/reports/ "
                f"(fichero *code-review*.md)")
    if verdict == "":
        return (f"el informe de code-review de '{change_name}' no tiene línea "
                f"`Veredicto: APTO`")
    return f"el code-review de '{change_name}' tiene veredicto NO APTO"


cmd = bash_command(load())

# Solo nos interesan los comandos que cierran un change.
is_archive = bool(re.search(r"\bopenspec\s+archive\b", cmd))
is_pr = bool(re.search(r"\bgh\s+pr\s+(create|merge)\b", cmd))
if not (is_archive or is_pr):
    ok()

problems = []

if is_archive:
    # Extrae el nombre del change: primer argumento no-flag tras "archive".
    m = re.search(r"openspec\s+archive\s+(.*)", cmd)
    change = None
    if m:
        for tok in m.group(1).split():
            if not tok.startswith("-"):
                change = tok
                break
    if not change:
        ok()  # forma no reconocida (p.ej. archivo interactivo); no bloqueamos a ciegas
    change_dir = os.path.join(CHANGES_DIR, change)
    if not os.path.isdir(change_dir):
        ok()  # no es un change activo conocido
    err = require_apto(change, change_dir)
    if err:
        problems.append(err)

if is_pr:
    # Fallback: exige informe APTO para cada change activo.
    changes = active_changes()
    if not changes:
        ok()
    for name, path in changes:
        err = require_apto(name, path)
        if err:
            problems.append(err)

if problems:
    block(
        "Gate de cierre bloqueado: el code-reviewer es OBLIGATORIO antes de "
        "`openspec archive` o de abrir/mergear un PR.\n- "
        + "\n- ".join(problems)
        + "\nEjecuta el agente code-reviewer sobre el diff, deja su informe en "
        "openspec/changes/<change>/reports/ con una línea `Veredicto: APTO`, y "
        "obtén la aprobación humana del gate final. Ver openspec/config.yaml "
        "(paso code-review) y docs/openspec-tasks-mandatory-steps.md."
    )

ok()
