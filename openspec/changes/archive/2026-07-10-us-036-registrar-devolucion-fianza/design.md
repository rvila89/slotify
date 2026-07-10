# Design — us-036-registrar-devolucion-fianza

> Decisiones técnicas no triviales. **CERRADAS en el Gate 1** (ver sección
> "Decisiones del Gate 1"). Los puntos que requerían criterio humano —**D-2** (dónde se persiste el
> motivo de retención) y **D-5** (superficie del endpoint del gestor y cómo llega el justificante)—
> quedan resueltos y **vinculantes**. El resto del documento se lee bajo esas decisiones.

## Decisiones del Gate 1 (humano — CERRADAS y vinculantes)

Confirmadas por el humano en el gate SDD. Prevalecen sobre las "recomendaciones" originales de D-2 y
D-5 (que se conservan más abajo como registro histórico del análisis, ya resueltas).

1. **G1-1 · Motivo de retención → campo dedicado nuevo `RESERVA.motivo_retencion`**
   (`String? @db.Text`). Se adopta la **opción (B) de D-2**. Migración **aditiva** (no destructiva),
   que **aplica el backend-developer**; el `contract-engineer` solo refleja el campo en el contrato
   (schema `Reserva.motivoRetencion`, nullable) y en el body del endpoint. Descarta la opción (A)
   `RESERVA.notas`.

2. **G1-2 · Endpoint → `POST /reservas/{id}/fianza/devolucion`** (sub-recurso, acción de registro
   del Gestor con JWT de usuario). Se adopta la **opción (A) de D-5 (verbo/ruta)**, **simétrica al
   cobro de fianza de US-030** (`POST /reservas/{id}/facturas/fianza/cobro`). Reemplaza el placeholder
   previo `POST /reservas/{id}/fianza/devolver` (que se sustituye por este endpoint materializado).
   `tenant_id` nunca en el path (viaja en el JWT); RLS por tenant.

3. **G1-3 · Justificante → patrón `justificanteDocId` de US-030/US-029, NO multipart.**
   Se adopta la **opción (b) de D-5**, alineada EXACTAMENTE con el cobro de fianza (US-030) y el cobro
   de liquidación (US-029). El fichero **no viaja como multipart** en este endpoint:
   - El fichero se sube **primero** por el endpoint genérico existente `POST /documentos` (multipart),
     que crea el `DOCUMENTO tipo='justificante_pago'`.
   - El body de `POST /reservas/{id}/fianza/devolucion` es **`application/json`** y **referencia**
     `justificanteDocId` (uuid, **OPCIONAL, nullable**). Omitido / `null` → registro válido **sin**
     justificante (FA-04), con aviso.
   - `justificanteDocId` inexistente en el tenant → **404 `JUSTIFICANTE_NO_ENCONTRADO`** (mismo código
     y semántica que US-030).
   Queda **descartada** la opción (a) multipart en el mismo request. Toda mención previa a multipart en
   este change (D-5 opción (a), D-6, D-7, tasks) se entiende **superada** por esta decisión.

## Context

US-036 (UC-27 pasos 4–8, FA-01/FA-02, actor **Gestor**) cierra el sub-proceso de fianza: el gestor
registra en Slotify la devolución que ejecutó **externamente** en su banca, y el sistema deja la
fianza en un **estado final** (`devuelta` o `retenida_parcial`) con importe, fecha y justificante.
La infraestructura que necesita **ya existe y se reutiliza**:

- **US-034** (archivada) deja la RESERVA en `post_evento`.
- **US-030** (archivada) dejó `RESERVA.fianza_status = 'cobrada'`, `RESERVA.fianza_eur` (importe
  cobrado) y `RESERVA.fianza_cobrada_fecha`, y aportó el **patrón de cobro de fianza** que US-036
  reutiliza casi al completo: transacción atómica sobre la fila de RESERVA, **guarda de estado con
  `SELECT ... FOR UPDATE`** contra doble registro, `DOCUMENTO (tipo = 'justificante_pago')` opcional,
  y AUDIT_LOG. US-036 es el **paso simétrico** del cobro, en sentido inverso.
- **US-035** (archivada) dejó `CLIENTE.iban_devolucion IS NOT NULL` (precondición de disponibilidad).
- **`RESERVA.fianza_devuelta_eur`** (`Decimal(10,2)?`), **`RESERVA.fianza_devuelta_fecha`**
  (`DateTime?`) y los valores de enum **`FianzaStatus.devuelta`** y **`FianzaStatus.retenida_parcial`**
  **ya existen** en el schema Prisma (`apps/api/prisma/schema.prisma`, model `Reserva`, enum
  `FianzaStatus`). **No hay migración de esquema** salvo que el gate elija un campo `motivo_retencion`
  dedicado (D-2).
- **`DOCUMENTO` polimórfica** con `tipo = 'justificante_pago'` ya en uso (US-029/US-030). El puerto
  endurecido de US-029/US-030 (`crear`/`buscar` acotado por `tipo` Y `reservaId` Y `tenant`) se
  reutiliza.
- **`AuditLogPort`** compartido con `usuarioId` **poblado** (acción de Usuario, no de Sistema). RLS
  por tenant vía el JWT del gestor.

Este documento fija las decisiones no triviales.

## D-1. Campos de RESERVA implicados y transacción atómica

**Campos mutados en RESERVA** (todos ya existentes en el schema):
- `fianza_status`: `'cobrada'` → `'devuelta'` **o** `'retenida_parcial'` (derivado, ver D-3).
- `fianza_devuelta_eur` (`Decimal(10,2)?`): el importe efectivamente devuelto (`0.00 ≤ x ≤ fianza_eur`).
- `fianza_devuelta_fecha` (`DateTime?`): la fecha real del abono (`≥ fianza_cobrada_fecha`).
- Motivo de retención (solo en `retenida_parcial`): destino a decidir en **D-2**.

**Campos leídos (no mutados)**: `estado` (= `post_evento`), `fianza_eur` (tope y comparación para el
estado final), `fianza_cobrada_fecha` (validación temporal); y `CLIENTE.iban_devolucion` (precondición
de disponibilidad).

**Transacción única atómica** (`$transaction`, patrón US-030): (1) `SELECT ... FOR UPDATE` sobre la
fila de RESERVA (agregado raíz, portador de `fianza_status`); (2) reevaluar la precondición y la
guarda de doble registro dentro de la transacción (D-4); (3) validar importe y fecha (D-3, dominio
puro, en realidad **antes** de abrir la transacción para fallar barato, y **re-chequeadas** dentro);
(4) crear el `DOCUMENTO` si se adjuntó justificante; (5) `UPDATE RESERVA` con `fianza_status`,
`fianza_devuelta_eur`, `fianza_devuelta_fecha` (+ motivo); (6) `AUDIT_LOG`. Todo en el mismo commit.
**Sin locks distribuidos** (hook `no-distributed-lock`): el mismo `SELECT ... FOR UPDATE` del bloqueo
de fecha, jamás Redis/Redlock.

## D-2. Dónde se persiste el motivo de retención (RESUELTA en Gate 1 → opción B, ver G1-1)

**Tensión.** La devolución parcial / retención total (FA-01) exige un **motivo de retención** (texto
libre, p. ej. "Daños en vajilla valorados en 500 €"). El schema Prisma **no** tiene hoy un campo
`motivo_retencion` en `RESERVA`; sí existe **`RESERVA.notas` (`String? @db.Text`)**. La US lo deja
explícitamente abierto: "almacenado en `RESERVA.notas` o campo auxiliar" (`US-036 §Reglas de negocio`).

- **Opción (A) — reutilizar `RESERVA.notas`** (sin migración): se **antepone/concatena** una entrada
  estructurada al `notas` existente (p. ej. `"[Retención fianza 2026-06-06] Daños en vajilla…"`),
  preservando el contenido previo. Ventaja: cero migración, entrega más rápida. Inconveniente: `notas`
  es un campo de propósito general; mezclar el motivo de retención con otras notas dificulta consultarlo
  de forma estructurada y auditarlo de forma aislada.
- **Opción (B) — campo dedicado `RESERVA.motivo_retencion` (`String? @db.Text`)** (con migración
  aditiva, no destructiva): semántica clara, consultable y auditable de forma aislada, alineado con
  tener `fianza_devuelta_eur`/`fianza_devuelta_fecha` como campos propios. Inconveniente: requiere una
  migración Prisma y actualizar `docs/data-model.md` + `er-diagram.md`.
- **Recomendación**: **(B)** por coherencia con el resto de campos de fianza (ya dedicados) y por
  auditabilidad limpia del motivo (`datos_nuevos.motivo_retencion`). Es una migración **aditiva** de
  bajo riesgo. Si se prioriza cero-migración para esta US, **(A)** es aceptable como deuda documentada.
  **A confirmar en el gate humano.** El resto del diseño (spec-delta, use-case, AUDIT_LOG) queda
  redactado de forma **agnóstica al destino** ("el motivo de retención queda persistido en el
  expediente"), para no bloquear el gate.

> Nota: el motivo solo es obligatorio cuando el resultado es `retenida_parcial`. En `devuelta`
> (importe completo) no hay motivo.

## D-3. Derivación del estado final y validaciones (regla de dominio pura)

- **Derivación del estado** (pura, sin infra): dado `importe_devuelto` y `fianza_eur`:
  - `importe_devuelto == fianza_eur` ⇒ `fianza_status = 'devuelta'` (devolución completa).
  - `importe_devuelto < fianza_eur` (incluido `0.00`) ⇒ `fianza_status = 'retenida_parcial'`
    (parcial o retención total). `fianza_devuelta_eur = 0.00` es **válido**.
- **Validación de importe (FA-02)**: `importe_devuelto ≤ fianza_eur`. Un `importe_devuelto >
  fianza_eur` devuelve `422` con "El importe a devolver no puede superar la fianza cobrada" y **no**
  toca BD. También `importe_devuelto ≥ 0` (no negativo).
- **Validación de fecha (FA-03)**: `fecha_cobro ≥ fianza_cobrada_fecha`. Una fecha anterior devuelve
  `422` con "La fecha de devolución no puede ser anterior a la fecha de cobro de la fianza (…)". La
  comparación se hace a nivel de **fecha** (no hora); la `fianza_cobrada_fecha` se lee de la RESERVA.
  `fecha_cobro` es **obligatoria**.
- **Comparación de importes con `Decimal`**: se comparan como decimales de 2 posiciones (Prisma
  `Decimal`), no como `number` de coma flotante, para evitar falsos negativos de igualdad en la
  derivación `== fianza_eur`.
- **Precede a toda escritura**: las validaciones se ejecutan **antes** de abrir la transacción de
  UPDATE (fallo barato) y la guarda de precondición/estado se **re-chequea dentro** de la transacción
  tras el `FOR UPDATE` (D-4). Estas validaciones son lógica de **dominio puro** (arrow functions).

## D-4. Guarda contra doble registro y precondición triple (concurrencia)

- **Precondición triple** (evaluada tras el `FOR UPDATE`, dentro de la transacción):
  `RESERVA.estado = 'post_evento'` **Y** `RESERVA.fianza_status = 'cobrada'` **Y**
  `CLIENTE.iban_devolucion IS NOT NULL`. Si falta cualquiera, la acción se **rechaza** (`409`
  conflicto de estado / fianza no cobrada / sin IBAN) sin tocar BD ni crear DOCUMENTO. El backend
  **no confía** en la UI.
- **Guarda contra doble registro**: si `fianza_status ∈ {'devuelta', 'retenida_parcial'}` (ya
  registrada), un nuevo intento se **rechaza** ("La devolución de la fianza ya está registrada") sin
  crear un segundo registro. La guarda se evalúa **dentro de la transacción** releyendo
  `RESERVA.fianza_status` con `SELECT ... FOR UPDATE` sobre la fila de RESERVA (idéntico patrón que la
  guarda de doble cobro de US-030): dos peticiones concurrentes se **serializan**; la primera deja el
  estado final, la segunda lo ve y aborta.
- **Irreversibilidad**: una vez en `devuelta`/`retenida_parcial`, el estado **no retrocede** a
  `cobrada` (la acción es irreversible en MVP; no hay endpoint de reversión).
- **Sin locks distribuidos**: la serialización es del motor SQL (`SELECT ... FOR UPDATE`), jamás
  Redis/Redlock (hook `no-distributed-lock`).

## D-5. Endpoint del gestor y llegada del justificante (RESUELTA en Gate 1 → ruta (A) + justificante (b), ver G1-2/G1-3)

La acción es **manual del gestor** (JWT de usuario, **no** `X-Cron-Token`). Opera sobre una RESERVA
concreta en `post_evento` con `fianza_status = 'cobrada'` e `iban_devolucion` presente.

- **Opciones de verbo/ruta** (a fijar tras el gate por el `contract-engineer`):
  - **(A)** `POST /reservas/{id}/fianza/devolucion` — acción de registro contextualizada en la
    reserva de post-evento (recomendada: simétrica al cobro de US-030
    `POST /reservas/{id}/facturas/fianza/cobro`, deja el sub-recurso `fianza/devolucion` explícito).
  - **(B)** `PATCH /reservas/{id}` con los campos `fianza_devuelta_*` — refleja que muta la RESERVA,
    pero mezcla la acción de negocio con una edición genérica y pierde la semántica del sub-proceso.
- **Recomendación de verbo/ruta**: **(A)**. Respuestas: `200/201` éxito (con la RESERVA actualizada:
  `fianza_status`, `fianza_devuelta_eur`, `fianza_devuelta_fecha` y, si aplica, el `DOCUMENTO`
  creado); `200` con **aviso** si se registró **sin** justificante (FA-04); `422` validación de
  importe/fecha (FA-02/FA-03); `409` precondición triple incumplida o devolución ya registrada
  (doble registro). **A confirmar en el gate y el contrato.**
- **Cómo llega el justificante** (a fijar en el gate):
  - **(a)** `multipart/form-data` en el **mismo** request (campos + archivo) — una sola llamada; el
    backend crea el `DOCUMENTO` dentro de la transacción. Más simple de UX (un solo submit).
  - **(b)** Subida previa por el **flujo de documentos existente** y paso de `justificante_doc_id`
    opcional en el body (patrón exacto de US-030, donde `PAGO.justificante_doc_id` referencia un
    DOCUMENTO ya subido). Más consistente con US-030, reutiliza el endpoint de subida ya vivo.
  - **Recomendación**: **(b)** por consistencia con US-030 (el justificante de fianza ya se modeló
    así en el cobro) y para no introducir manejo de multipart si el flujo de subida ya existe. Si en
    el gate se prefiere una sola llamada de UX, **(a)** es viable. **A confirmar en el gate.**
- El cliente HTTP del frontend se **regenera** desde el contrato (nunca a mano; hook
  `protect-generated-client`).

## D-6. Justificante como DOCUMENTO (tipo = justificante_pago), opcional (FA-04)

- **[G1-3] El justificante se sube antes por `POST /documentos` (multipart) y aquí solo se
  referencia por `justificanteDocId`; este endpoint NO recibe multipart.** El DOCUMENTO
  (`tipo='justificante_pago'`, `reserva_id`, `url`, `mime_type`, `nombre_archivo`, `tamano_bytes?`,
  `tenant_id`) ya existe cuando llega este request; la devolución solo lo **vincula** (validando que
  el id exista en el tenant, si no → 404 `JUSTIFICANTE_NO_ENCONTRADO`) dentro de la misma transacción
  del registro; `AUDIT_LOG` con la traza del vínculo. Patrón idéntico a US-030/US-029.
- **Opcional (FA-04)**: si el gestor no adjunta justificante, la devolución se registra **igualmente**
  con una advertencia ("⚠️ Devolución registrada sin justificante. Puedes adjuntarlo más tarde desde
  la ficha de documentos de la reserva."), `fianza_status` avanza al estado final y **no** se crea
  `DOCUMENTO`. El justificante es **recomendado pero no bloqueante** en MVP.
- Reuso de la entidad polimórfica ya viva (US-024/US-029/US-030) **sin** cambiar el modelo de
  DOCUMENTO.

## D-7. Frontend: formulario de devolución en la ficha de post-evento

- **Formulario "Registrar devolución de fianza"** en la ficha de la reserva (acción del Gestor):
  campos `importe_devuelto`, `fecha_cobro`, adjuntar justificante (opcional), y `motivo_retencion`
  **condicional** (se muestra/exige solo cuando `importe_devuelto < fianza_eur`). **[G1-3] El
  justificante se sube primero por `POST /documentos` (multipart) y el formulario pasa el
  `justificanteDocId` resultante en el body JSON** — mismo flujo de dos pasos que el formulario de
  cobro de US-030; este endpoint no recibe multipart.
- **Guardas de UI**: el formulario/acción solo es visible/habilitado cuando `estado = 'post_evento'`
  **Y** `fianza_status = 'cobrada'` **Y** `iban_devolucion` presente; si `fianza_status ∈ {devuelta,
  retenida_parcial}` la acción se deshabilita/oculta y se muestra el estado final
  (`fianza_devuelta_eur`, `fianza_devuelta_fecha`, motivo si parcial). El backend **revalida** (no
  confía en la UI).
- **Validación en cliente** para UX inmediata (`importe_devuelto ≤ fianza_eur`, `fecha_cobro ≥
  fianza_cobrada_fecha`, motivo requerido si parcial), pero el **backend revalida** (FA-02/FA-03).
  Muestra el error de FA-02/FA-03 y la advertencia de FA-04 (registro sin justificante).
- **Responsive obligatorio** (regla dura): mobile-first, sin overflow horizontal, objetivos táctiles
  accesibles, verificado en 390/768/1280 en QA (Playwright), estructura Bulletproof por feature
  (`features/<dominio>/`, barrel `index.ts`, `max-lines ≤ 300`). **A validar en el gate**: en qué
  feature vive el formulario y si se reutiliza el patrón del formulario de cobro de US-030.
- Por haber cambios de frontend, **aplica el E2E con Playwright MCP** (`step-N+3`).

## Firmas previstas de casos de uso (dominio/aplicación)

```ts
// application — transición atómica cobrada → {devuelta | retenida_parcial} (patrón US-030)
type RegistrarDevolucionFianzaInput = {
  reservaId: string;
  tenantId: string;
  importeDevuelto: number;        // 0 ≤ x ≤ fianza_eur (validación de dominio)
  fechaCobro: string;            // ISO date, ≥ fianza_cobrada_fecha (validación de dominio)
  motivoRetencion?: string;      // requerido si el resultado es 'retenida_parcial' (FA-01)
  justificanteDocId?: string;    // opcional (FA-04) — o multipart, según D-5
};
type RegistrarDevolucionFianzaResult = {
  reserva: {
    fianzaStatus: 'devuelta' | 'retenida_parcial';
    fianzaDevueltaEur: number;
    fianzaDevueltaFecha: string;
  };
  documentoJustificante?: Documento;  // presente solo si se adjuntó (FA-04)
  avisoSinJustificante?: boolean;     // true si se registró sin justificante
};

const registrarDevolucionFianza:
  (deps: RegistrarDevolucionFianzaDeps) => (i: RegistrarDevolucionFianzaInput)
    => Promise<RegistrarDevolucionFianzaResult>;

// domain puro — validaciones + derivación del estado final
const validarDevolucionFianza:
  (i: { importeDevuelto: Decimal; fianzaEur: Decimal; fechaCobro: Date;
        fianzaCobradaFecha: Date; motivoRetencion?: string }) => void;
  // lanza si importe > fianza_eur, importe < 0, fecha_cobro < fianza_cobrada_fecha,
  // o motivo ausente cuando el resultado sería retenida_parcial
const derivarEstadoFianzaDevolucion:
  (i: { importeDevuelto: Decimal; fianzaEur: Decimal }) => 'devuelta' | 'retenida_parcial';
const puedeRegistrarDevolucion:
  (i: { estado: string; fianzaStatus: string; ibanDevolucion: string | null }) => Resultado;
  // rechaza si estado ≠ post_evento, fianza_status ≠ cobrada, o iban_devolucion == null;
  // rechaza (doble registro) si fianza_status ∈ {devuelta, retenida_parcial}
```

`RegistrarDevolucionFianzaDeps` incluye: puerto de RESERVA (lectura con `FOR UPDATE` + transición
`fianza_status` + set de `fianza_devuelta_eur`/`fianza_devuelta_fecha`/motivo, lectura de `fianza_eur`
y `fianza_cobrada_fecha`), puerto de CLIENTE (lectura de `iban_devolucion` para la precondición),
puerto de DOCUMENTO (crear el justificante si aplica, reuso endurecido US-029/US-030), UoW/transacción
y AUDIT_LOG. El dominio **no** importa infraestructura (hexagonal).

## Guardrails que aplican

- **Hexagonal**: validaciones, derivación del estado y guarda de precondición en dominio puro; puertos
  (RESERVA, CLIENTE, DOCUMENTO) en dominio, adaptadores en infra. Hook `no-infra-in-domain`.
- **Bloqueo sin locks distribuidos**: la guarda de doble registro usa `SELECT ... FOR UPDATE` de
  PostgreSQL sobre la fila de RESERVA dentro de la `$transaction`; **jamás** Redis/Redlock (hook
  `no-distributed-lock`).
- **Multi-tenancy/RLS**: `tenant_id` en toda mutación y query (RESERVA, CLIENTE, DOCUMENTO, AUDIT_LOG).
- **TDD**: tests primero de la guarda de doble registro concurrente (`FOR UPDATE`), de la máquina de
  estados de fianza (`cobrada → devuelta`, `cobrada → retenida_parcial`, bloqueo desde estado final,
  rechazo de precondición) y de las validaciones/derivación de dominio (importe ≤ fianza_eur, `0.00`
  válido, fecha ≥ fianza_cobrada_fecha, motivo requerido en parcial) **antes** de implementar.
- **Migración**: **ninguna** si el motivo va a `RESERVA.notas` (D-2 opción A); **aditiva** si se elige
  campo `motivo_retencion` dedicado (D-2 opción B). Los campos `fianza_devuelta_*` y los valores de
  enum ya existen.
- **Arrow-functions** (regla dura ESLint): todo helper/factory/hook/handler como expresión de flecha.
- **Web responsive** (regla dura): el formulario mobile-first (390/768/1280).
- **Cliente HTTP generado, nunca editado a mano**; el SDK se regenera desde el contrato.
