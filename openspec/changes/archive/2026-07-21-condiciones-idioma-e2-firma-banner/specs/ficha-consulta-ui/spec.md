# Spec-delta: condiciones-idioma-e2-firma-banner (capability `ficha-consulta-ui`)

## ADDED Requirements

### Requirement: Registrar firma de condicions particulars muestra banner inline, no toast

La UI SHALL (DEBE) mostrar un banner verde inline al registrar con éxito la firma de
condicions particulars (primera vez o re-subida), haciendo scroll al inicio de la página
en lugar del toast Sonner actual. El patrón MUST (DEBE) ser idéntico al del resto de
acciones de desenlace de la ficha: color `border-emerald-200 bg-emerald-50`, icono
`CheckCircle2`, mensaje descriptivo, botón de cierre, gestionado por `useAvisosFicha`.

El sistema SHALL (DEBE) implementar:
- `AvisoCondicionesFirmadas` (nuevo componente): acepta `tipo: 'registrada' | 'reregistrada'`
  y `onCerrar`. Mensajes diferenciados por tipo.
- `useAvisosFicha`: añade `firma: 'registrada' | 'reregistrada' | null` + `mostrarFirma(tipo)`.
- `AvisosFicha`: renderiza `AvisoCondicionesFirmadas` cuando `firma !== null`.
- `CondicionesFirmadasCard`: acepta `onRegistrado?: (tipo) => void`; invoca la prop
  en lugar de `notify.success()` cuando está disponible.
- `FichaConsultaPage`: callback `onRegistrado` → `avisos.mostrarFirma(tipo)` + scroll top.

#### Scenario: Registrar firma por primera vez muestra banner de registro

- **GIVEN** una RESERVA en `reserva_confirmada` con `condPartFirmadas = false`
- **WHEN** el gestor adjunta el documento firmado y confirma en el diálogo
- **THEN** el diálogo se cierra
- **AND** la página hace scroll al inicio
- **AND** aparece un banner verde inline con mensaje de primera firma registrada
- **AND** NO aparece ningún toast Sonner

#### Scenario: Re-subir una versión firmada muestra banner diferenciado

- **GIVEN** una RESERVA con `condPartFirmadas = true`
- **WHEN** el gestor sube una versión más legible del documento firmado
- **THEN** el banner inline muestra el mensaje de nueva versión registrada
- **AND** el mensaje es distinto al de la primera firma

#### Scenario: FichaConsultaPage conecta CondicionesFirmadasCard con el sistema de avisos

- **GIVEN** la `FichaConsultaPage` renderizando `SeccionesFicha` con `CondicionesFirmadasCard`
- **WHEN** `CondicionesFirmadasCard` llama al callback `onRegistrado`
- **THEN** `useAvisosFicha.mostrarFirma(tipo)` se invoca
- **AND** `window.scrollTo({ top: 0, behavior: 'smooth' })` se ejecuta

---

### Requirement: Mensaje de condicions no enviadas referencia E2

El aviso de "condicions no enviadas" en `CondicionesFirmadasCard` SHALL (DEBE) referenciar
el email E2 (presupuesto), no E3. El texto "(E3)" MUST (DEBE) sustituirse por "(E2)".

#### Scenario: Aviso de condicions no enviadas referencia E2

- **GIVEN** una RESERVA donde `condPartFechaEnvio` es null
- **WHEN** el gestor visualiza la tarjeta de firma de condicions
- **THEN** el aviso indica que las condicions se envían con el presupuesto "(E2)"
- **AND** no hay ninguna referencia a "(E3)" en ese aviso
