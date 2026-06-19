"""Utilidades compartidas por los hooks del harness de Slotify.

Los hooks de Claude Code reciben un JSON por stdin con, al menos:
  { "tool_name": "...", "tool_input": { ... } }

Convención de salida:
  - exit 0  -> permitir (stdout opcional informativo)
  - exit 2  -> bloquear (PreToolUse) / señalar error (PostToolUse). El texto de
               stderr se muestra al modelo para que corrija.
"""
import json
import sys


def load():
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)  # sin payload válido, no bloqueamos
    return data


def tool_input(data):
    return data.get("tool_input", {}) or {}


def target_path(data):
    ti = tool_input(data)
    return ti.get("file_path") or ti.get("path") or ""


def edited_text(data):
    """Texto que el agente intenta introducir (Write: content; Edit: new_string)."""
    ti = tool_input(data)
    parts = []
    for k in ("content", "new_string", "new_str"):
        if ti.get(k):
            parts.append(ti[k])
    return "\n".join(parts)


def block(msg):
    sys.stderr.write(msg.strip() + "\n")
    sys.exit(2)


def ok(msg=""):
    if msg:
        sys.stdout.write(msg.strip() + "\n")
    sys.exit(0)
