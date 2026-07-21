# Design — factura-senal-pdf-idioma-email-ux

## D1 — `e3Enviado`: flag en contrato vs estado local frontend

**Decisión:** Flag `e3Enviado: boolean` en el contrato (`FacturaSenalResponse`), cargado desde BD.

**Alternativa descartada:** Estado local en `EnvioFacturaSenal` (`yaEnviado` gestionado por el componente). Problema: no sobrevive a recarga de página; el gestor vería "Enviar" aunque E3 ya se envió en otra sesión.

**Por qué contract:** Fuente única de verdad; el `GET /reservas/{id}/factura-senal` devuelve siempre el estado real. El campo es additive (non-breaking). El adapter Prisma añade un `findFirst` en COMUNICACION (O(1) con índice `reserva_id`).

## D2 — E3 por catálogo vs texto en adaptador directo

**Decisión:** Los adapters `EnviarE3EmisionAdapter` y `ReenviarE3Adapter` inyectan `CatalogoPlantillasPort`, renderizan el template (`seleccionar('E3', idioma).render({nombre, codigoReserva})`) y pasan el `asunto`/`cuerpoHtml`/`cuerpoTexto` resueltos a `EnviarEmailPort.enviar()`.

**Alternativa descartada:** Pasar por `DespacharEmailService` (como E2). Requeriría refactorizar el flujo completo de emisión (unidad de trabajo, puertos) y desacoplar la firma de `DespacharEmailComando`. El patrón de inyectar el catálogo directamente en el adapter de infra es más localizado y evita acoplamiento de módulos.

**Fallback de idioma:** Si `idioma` no tiene plantilla CA (p. ej. algún futuro E5), el adapter usa `seleccionar('E3', 'es')` como fallback, coherente con el comportamiento del motor.

## D3 — Nombre del adjunto PDF

**Decisión:** `${senal.numeroFactura ?? 'Factura'} ${reserva.clienteNombre} ${reserva.clienteApellidos}.pdf`

El `numeroFactura` viene del campo ya persistido (`F-2026-0029`). No se altera el formato de numeración fiscal. El nombre solo afecta al nombre del archivo adjunto del email, no a la clave de almacenamiento.

## Resumen de decisiones al gate

| # | Decisión | Resolución |
|---|----------|------------|
| D1 | `e3Enviado`: flag backend vs estado local | **Backend** — fuente única de verdad |
| D2 | E3 por catálogo inyectado vs `DespacharEmailService` | **Catálogo inyectado** — más localizado |
| D3 | Nombre adjunto PDF | `{numeroFactura} {nombre} {apellidos}.pdf` |
