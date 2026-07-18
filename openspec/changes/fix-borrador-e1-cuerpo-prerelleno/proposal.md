# Change: fix-borrador-e1-cuerpo-prerelleno

## Why

**Fix sobre US-045 / US-047 — El borrador E1 creado con comentarios nace con el cuerpo
vacío** (Área: Comunicaciones / Consultas; Módulo M10; UC-35 / UC-36).

Cuando el gestor da de alta una consulta **con comentarios**, el sistema no auto-envía el
E1: lo deja en `estado = 'borrador'` para que el gestor lo revise, complete y envíe (US-045,
`R-Cableado real de E1 …`; refinado por US-047). El uso real ha revelado un bug: **ese
borrador nace con el cuerpo vacío** (`cuerpo: ''`) y un asunto placeholder, de modo que el
gestor abre el diálogo de revisión y se encuentra un correo en blanco. Pierde todo el texto
del E1 (saludo personalizado, bloque según la casuística de fecha, información del espacio)
que sí recibe el cliente por la vía automática.

Causa raíz (`apps/api/src/reservas/application/alta-consulta.use-case.ts`):

- Dentro de la transacción del alta, la fila E1 se crea en `borrador` con
  `asunto: ASUNTO_E1_PLACEHOLDER` y `cuerpo: ''`; el cuerpo real se renderiza **post-commit**
  (la casuística `tipoE1` depende del sub-estado ya commiteado).
- El efecto post-commit hace `return` temprano cuando hay comentarios
  (`!enviarAutomaticamente`), **antes** del bloque de render. El render de E1 solo se ejecuta
  en la rama de auto-envío → con comentarios el borrador se queda con el cuerpo vacío.

Esto rompe la intención de negocio de US-047 (el sistema pre-rellena y adjunta; el gestor
solo revisa y confirma): el gestor debería partir del E1 ya redactado —mismo idioma y misma
gestión de fechas que el E1 automático— y añadir lo que quiera antes de enviarlo. El envío
posterior ya existe y es correcto: `EnviarBorradorUseCase` (US-046) envía
`comando.cuerpo ?? comunicacion.cuerpo`, así que rellenar el cuerpo al alta es exactamente lo
que hace que el envío manual salga con el texto completo (y US-047 D-2 ya adjunta el dossier
por idioma en ese envío).

US-045 (**motor de email**, catálogo de plantillas E1 por idioma, render por `tipoE1`,
adjunto de dossier) y US-046 (**superficie HTTP de comunicaciones**: listar, enviar borrador
con edición opcional) están **archivadas**. Este fix **parte de su estado y reutiliza sus
puertos**: no reimplementa el transporte de email, el catálogo, el bloqueo atómico de fecha
ni la máquina de estados de la RESERVA.

## What Changes

- **El borrador E1 con comentarios nace con asunto y cuerpo renderizados**
  (`comunicaciones` / `AltaConsultaUseCase`): cuando el alta incluye comentarios y por tanto
  el E1 queda en `borrador`, el sistema renderiza la plantilla E1 **con paridad exacta al
  E1 automático** —mismo idioma (`RESERVA.idioma`, default `'es'`) y misma casuística de
  fecha `tipoE1` (`sin_fecha` / `fecha_disponible` / `fecha_cola` / `fecha_confirmada`,
  incluyendo fechas alternativas del mismo fin de semana en `fecha_confirmada`)— y
  **persiste `asunto` y `cuerpo`** en la fila `borrador`, manteniéndola en `borrador` y sin
  enviar. El gestor edita sobre ese texto completo y lo envía por la ruta de US-046 (que ya
  adjunta el dossier, US-047 D-2).
- **Render compartido por un único helper**: el cálculo de `tipoE1` + fechas alternativas +
  `catalogo.seleccionar('E1', idioma).render(...)` (hoy en la rama de auto-envío) se extrae a
  un helper privado reutilizado por ambas ramas → **paridad por construcción** entre el
  cuerpo del borrador y el del auto-envío.
- **Persistencia del contenido del borrador** (`comunicaciones` / puerto de repositorio):
  se añade `actualizarContenidoBorrador(tenantId, idComunicacion, asunto, cuerpo)` al
  `ComunicacionRepositoryPort`, que actualiza **solo** `asunto` + `cuerpo` de una fila en
  `estado = 'borrador'` (guarda de estado + RLS). Lo expone el `DespacharEmailService` (ya
  inyectado en el alta) como método delegado, sin wiring ni tokens nuevos.

### Entidades tocadas

- `COMUNICACION`: **sin cambios de estado ni de columnas**. La fila E1 `borrador` (que hoy
  ya se crea) recibe un **UPDATE** de `asunto` + `cuerpo` post-commit; permanece en
  `borrador` sin `fecha_envio`. No cambia el enum ni el esquema.
- `RESERVA`: **solo lectura** de `idioma` y `fecha_evento` (ya persistidos) y del sub-estado
  ya commiteado para elegir la variante `tipoE1`. No se muta.
- `AUDIT_LOG`, `FECHA_BLOQUEADA`, `CLIENTE`: **NO se mutan** por este fix.

### Dependencia de datos

- **Sin migración de esquema propia**: no añade columnas ni índices. Reutiliza el catálogo
  de plantillas y el mecanismo de persistencia de `COMUNICACION` de US-045; el UPDATE es
  sobre una fila existente por PK bajo RLS.

### Trazabilidad

- **US**: fix sobre `US-045` (cableado real de E1, render por `tipoE1`) y `US-047`
  (comportamiento del borrador E1).
- **UC**: UC-35 (respuesta inicial automática E1 / dossier), UC-36 (revisar y enviar borrador).
- **ER**: `er-diagram §3.17 COMUNICACION`, `§3.6 RESERVA` (`idioma`, `fecha_evento`).
- **Depende de**: US-045 (motor de email, catálogo E1, render por `tipoE1` — archivada),
  US-046 (`EnviarBorradorUseCase`, superficie HTTP — archivada), US-047 (comportamiento del
  borrador E1, dossier al enviar — archivada).
- **Reutiliza** de la spec viva `comunicaciones`: "Cableado real de E1 personalizado por
  idioma, situación de fecha y dossier adjunto" (mismo render por `tipoE1` e idioma),
  "Registro en COMUNICACION" (persistencia de la fila); de `consultas`: "Idioma y horario
  opcionales en el alta de consulta" (`RESERVA.idioma`).

## Impact

- Specs afectadas:
  - `openspec/specs/comunicaciones/spec.md` — **MODIFIED** "Cableado real de E1 personalizado
    por idioma, situación de fecha y dossier adjunto": el borrador E1 creado con comentarios
    nace con `asunto` y `cuerpo` renderizados (idioma + casuística de fecha), no vacío,
    manteniéndose en `borrador`.
- Código (post-gate, fuera de este SDD):
  - Backend: `AltaConsultaUseCase` (extraer helper de render + ramificar el post-commit para
    persistir el borrador con comentarios); `ComunicacionRepositoryPort` +
    adapter Prisma (`actualizarContenidoBorrador`); `DespacharEmailService` (método delegado);
    `reservas.module.ts` (cablear el puerto reutilizando el `DespacharEmailService` ya inyectado).
  - Contrato: **sin cambios** (`Comunicacion.cuerpo` ya está en `docs/api-spec.yml` y
    `ComunicacionListItem` lo hereda vía `allOf`). Sin regeneración de SDK.
  - Frontend: **sin cambios** (el diálogo de revisión ya precarga `cuerpo`).
- **Decisiones para visto bueno humano** (ver `design.md`): (D-1) puerto del UPDATE
  reutilizando el `DespacharEmailService` ya inyectado; (D-2) render compartido por helper
  para paridad exacta; (D-3) el UPDATE post-commit es best-effort y no tumba el 201; (D-4)
  sin cambio de contrato ni frontend.
