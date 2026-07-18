# Step Review — Code Review (guardrails + checklist)

**Fecha:** 2026-07-18
**Change:** us-047-borrador-e1-comportamiento
**Rama:** feature/us-047-borrador-e1-comportamiento (vs master 11191dd)
**Revisor:** code-reviewer (solo lectura)

> Estado de la rama: TODO el diff esta SIN COMMITEAR (working tree). No hay commits
> sobre master. La verificacion se hizo sobre `git diff master` del arbol de trabajo.

---

## Resumen

US-047 refina el comportamiento del borrador E1: adjunto de dossier al enviar (paridad
con el alta), flag tieneBorradorE1Pendiente en el pipeline y en el detalle, bloqueo de
AccionesConsulta, modal max-w-2xl, retirada del boton "Descartar" en la UI y badge ambar
en kanban/listado. La implementacion es correcta en lo esencial: hexagonal intacto,
multi-tenancy correcto, paridad de adjunto exacta con el alta, arrow-functions y TS strict
sin any. Los 67 tests unitarios del alcance pasan.

Hallazgos NO bloqueantes: (1) el arbol de trabajo mezcla un change ajeno (idioma/horario
+ reescritura de E1 personalizada del alta) fuera del scope de US-047; (2) falta cobertura
unitaria de frontend del guard de AccionesConsulta; (3) falta test del guard de
path-traversal del adaptador Resend.

---

## Verificacion por guardrail / checklist

### 1. Hexagonal — OK
- listar-reservas.port.ts:77 anade tieneBorradorE1Pendiente: boolean (primitivo). Sin
  imports de nestjs/prisma/infrastructure.
- obtener-reserva.query.ts:73 anade tieneBorradorE1Pendiente?: boolean (primitivo,
  opcional/aditivo). Dominio limpio.
- Los adaptadores Prisma implementan el puerto sin filtrar hacia dominio.

### 2. Multi-tenancy — OK
- Pipeline: listar-reservas.prisma.adapter.ts:80 fija tenant (fijarTenant) y el where
  filtra por tenantId. La subconsulta comunicaciones (lineas 88-91) es relacion anidada
  del reserva.findMany, acotada a la reserva padre (ya scoped por tenant + RLS de
  COMUNICACION).
- Detalle: reserva-detalle-query.prisma.adapter.ts:43 fija tenant y findFirst con
  where { idReserva, tenantId }; misma subconsulta anidada. Aislamiento correcto.
- Derivacion re-verificada en memoria con some(c => codigoEmail==='E1' &&
  estado==='borrador'). Correcto.

### 3. Paridad de adjunto con AltaConsultaUseCase — OK
- enviar-borrador.use-case.ts:189-198 construye el AdjuntoRef con clave 'dossier',
  nombre Dossier-Masia-Encis-{idioma}.pdf, pdfUrl {dossierBaseUrl}/dossiers/... —
  IDENTICO al del alta (bloque dossierRef en alta-consulta.use-case.ts).
- Idioma desde la reserva ya cargada (comunicacion.idioma ?? 'es'), via
  cargar-comunicacion.prisma.adapter.ts:46 (reserva: { select: { idioma } }).
- Degradacion graceful: sin dossierBaseUrl -> sin adjuntos (paridad exacta).
- Solo adjunta cuando codigoEmail === 'E1'.
- dossierBaseUrl se resuelve igual en comunicaciones.module.ts:172-175 y reservas.module.

### 4. Arrow functions / TS strict — OK
- Sin function declarativas en codigo nuevo (metodos de clase NestJS exentos).
- Sin any injustificado en fuentes. Los as de los specs son widening controlado de fase
  RED, documentados. Importes en Decimal (no se tocan; adaptador serializa null->null).

### 5. Contrato — OK
- api-spec.yml:4481 anade tieneBorradorE1Pendiente al schema base Reserva; ReservaDetalle
  (allOf Reserva) lo hereda, coherente con que la ficha lo consuma.
- SDK regenerado schema.d.ts:3691 (base Reserva) — no editado a mano; coincide con el
  contrato. ReservaDetalle extiende Reserva (linea 3693).
- DTOs backend (listar-reservas.dto.ts:153, reserva-detalle.dto.ts:165) y controllers
  proyectan el campo.

### 6. Frontend — OK con matices
- AccionesConsulta.tsx:82 hace if (reserva.tieneBorradorE1Pendiente) return aviso ANTES
  de renderizar cualquier boton: cubre TODA la seccion, incluida "Marcar como descartada"
  (D-4 cumplido).
- Aviso: border-amber-200 bg-amber-50 text-amber-800 (contraste suficiente), icono Mail
  aria-hidden. [WARN] no lleva role="status" (mejora de a11y, no bloqueante).
- Badge ambar en ReservaKanbanCard.tsx:55 y ListadoView.tsx:61 con data-testid
  badge-borrador-e1-pendiente; en listado envuelto en inline-flex flex-wrap (no rompe
  layout). max-w-2xl w-full en el modal.
- Retirada de "Descartar": ComunicacionListaItem.tsx y ComunicacionesCard.tsx limpios,
  DescartarBorradorDialog.tsx eliminado; endpoint backend conservado.
- Responsive verificado por E2E en 390/768/1280 (report step-13 + capturas e2e-11..14).

### 7. Tests primero — OK (con hueco de FE)
- 67/67 verdes: enviar-borrador.use-case.spec.ts (E1 dossier ca, degrada a es, sin
  dossierBaseUrl, no-E1 sin adjunto), listar-reservas.prisma.adapter.spec.ts (true /
  false-sin-comm / false-E1-enviado), listar-reservas.use-case.spec.ts,
  obtener-reserva.query.spec.ts, catalogo-plantillas.spec.ts.
- [WARN] Sin test unitario de frontend del guard de AccionesConsulta
  (__tests__/AccionesConsulta.test.tsx no actualizado): el branch nuevo solo cubierto por
  E2E. Recomendado un caso: render del aviso + ausencia de botones.

### 8. Convenciones — OK
Nombres espanol, comentarios/errores en espanol, PascalCase/camelCase/kebab-case.

---

## Hallazgos

### Bloqueantes
- Ninguno.

### Altas
- Ninguna.

### Medias
- [WARN] Scope creep en el arbol de trabajo. El git diff master incluye ficheros AJENOS a
  US-047 (segun su tasks.md/proposal.md, que solo depende de la migracion idioma y solo
  lee reserva.idioma): reescritura de E1 personalizada en alta-consulta.use-case.ts
  (+146), catalogo-plantillas.ts (+178), resend.email.adapter.ts,
  fechas-alternativas.prisma.adapter.ts, schema.prisma, seed.ts, create-reserva.dto.ts, y
  en frontend NuevaConsultaPage.tsx, SeccionCliente.tsx, SeccionEvento.tsx, constants.ts,
  schema.ts. Es trabajo de otro change (idioma/horario + E1 personalizada) compartiendo el
  working tree. Recomendacion: separar en su propia rama/PR o dejar constancia explicita
  del alcance combinado antes del PR, para que el diff de US-047 no arrastre cambios no
  especificados. No bloquea la correccion funcional de US-047.

### Bajas
- [WARN] AccionesConsulta sin test unitario del guard E1 (solo E2E). Anadir caso en
  __tests__/AccionesConsulta.test.tsx.
- [WARN] resend.email.adapter.ts:88-101 (branch path-local -> Buffer con guard de
  path-traversal y extension .pdf) sin test unitario. El guard es correcto; cubrirlo
  (feliz + fuera de ALMACEN_LOCAL_DIR + extension no .pdf).
- [WARN] El aviso de bloqueo podria llevar role="status" para a11y.
- [Nota] dossierBaseUrl se lee de process.env directamente en los modulos pese a que
  ConfigService esta disponible; consistente con el patron existente del alta.

---

## Conclusion

US-047 cumple los guardrails arquitectonicos (hexagonal, multi-tenancy, bloqueo de fecha
no tocado, maquina de estados intacta), el contrato y las convenciones; la paridad del
adjunto E1 con el alta es exacta y los 67 tests del alcance pasan. Los hallazgos son NO
bloqueantes (higiene de scope del working tree y huecos de cobertura menores). Apto para
merge; se recomienda atender el scope creep separando el trabajo ajeno antes del PR.

Veredicto: APTO
