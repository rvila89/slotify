# Spec Delta — condiciones-idioma-e2-firma-banner

> Índice ejecutable de los cambios de requisitos por capability. Cada entrada apunta al
> archivo de delta dentro de este change (`specs/<capability>/spec.md`). Los requirements
> sin ID propio heredan el ID del requisito vivo más próximo que modifican.

---

## `openspec/specs/documentos/spec.md` → [`specs/documentos/spec.md`](specs/documentos/spec.md)

- **MODIFIED** — Puerto de generación del PDF de condicions particulars:
  El `params` de `GenerarPdfCondicionesPort.generar` pasa a aceptar `idioma: 'es' | 'ca'`
  además de `tenantId`. El adaptador `PdfCondicionesRealAdapter` usa `idioma` para
  seleccionar el texto del JSON bilingüe y usa clave de almacenamiento diferenciada por
  idioma (`condiciones/{tenantId}-{idioma}.pdf`). El renderizador recibe `idioma`.

---

## `openspec/specs/presupuestos/spec.md` → [`specs/presupuestos/spec.md`](specs/presupuestos/spec.md)

- **MODIFIED** — Confirmar presupuesto y activar pre-reserva:
  `confirmar()` añade guarda pre-tx: si `generarCondicionesPort.generar({ tenantId,
  idioma })` devuelve `null` (tenant sin condiciones) → 409 `CONDICIONES_NO_CONFIGURADAS`.
  Dentro de la tx: fija `RESERVA.cond_part_enviadas_fecha = now()` y
  `cond_part_firmadas = false`. La respuesta de `confirmar` incluye `condPartFechaEnvio`.

---

## `openspec/specs/comunicaciones/spec.md` → [`specs/comunicaciones/spec.md`](specs/comunicaciones/spec.md)

- **MODIFIED** — E2 (presupuesto enviado):
  `DispararE2Adapter` pasa `idioma: reserva.idioma` a `generarCondiciones.generar()`.
  El PDF de condiciones se adjunta a E2 de forma ordinaria (no fire-and-forget para
  ausencia de config, que ya se descartó en la guarda pre-tx; sí tolerante a fallos
  transitorios de render/subida).

- **MODIFIED** — E3 (factura de señal enviada):
  `EnviarFacturaSenalUseCase` elimina toda lógica de condiciones: sin generación, sin
  adjunto `condiciones`, sin guard `CONDICIONES_NO_CONFIGURADAS`, sin llamada a
  `fijarCondicionesEnviadas`. E3 adjunta solo la factura de señal.

---

## `openspec/specs/confirmacion/spec.md` → [`specs/confirmacion/spec.md`](specs/confirmacion/spec.md)

- **MODIFIED** — Envío de factura de señal (E3):
  `EnviarFacturaSenalUseCase` ya no lleva dependencia `GenerarCondicionesPort` ni
  `ReservasSenalEmisionPort.fijarCondicionesEnviadas`. `CondicionesNoConfiguradasError`
  deja de ser un error posible de E3. `EnviarFacturaSenalResultado` ya no incluye
  `condPartAdjuntada`.

---

## `openspec/specs/ficha-consulta-ui/spec.md` → [`specs/ficha-consulta-ui/spec.md`](specs/ficha-consulta-ui/spec.md)

- **MODIFIED** — Registrar firma de condicions particulars:
  Al registrar con éxito la firma (primera vez o re-subida), la UI muestra un **banner
  inline verde** arriba de la página (`AvisoCondicionesFirmadas`) y hace scroll al inicio,
  sustituyendo el toast Sonner actual. La tarjeta `CondicionesFirmadasCard` referencia
  `(E2)` en lugar de `(E3)` en el mensaje de aviso "condiciones no enviadas".
