# Spec Delta — Capability `ficha-operativa`

> **reserva-viva-edicion-recalculo-ficha** — La ficha operativa deja de tener campos de aforo y
> duración desacoplados y pasa a editar los campos ESTRUCTURADOS de la RESERVA
> (`duracionHoras` enum `{4,8,12}`, desglose de invitados `numAdultosNinosMayores4` +
> `numNinosMenores4`), igual que el editor de consulta. El "nº de invitados confirmado" se
> DERIVA. Además, la ficha se pre-rellena por completo AL LEER desde RESERVA/CLIENTE (no solo
> al crearla). Editar aforo/duración dispara el recálculo en cascada (ver deltas `presupuestos`,
> `facturacion`, `comunicaciones`), sujeto a la ventana viva (ver delta `reservas`).
>
> Fuente: petición de usuario (feature "Reserva viva"); `US-025` ficha operativa; `US-016`
> motor de tarifa; `derivar-num-personas.ts`; `ficha-operativa.dto.ts`; `er-diagram.md §3.6
> RESERVA`, `§3.14 FICHA_OPERATIVA`; `CLAUDE.md` máquina de estados / multi-tenancy.

## ADDED Requirements

### Requirement: Edición de los campos estructurados de aforo y duración de la RESERVA desde la ficha

El sistema SHALL (DEBE) permitir al Gestor editar, desde la ficha operativa de una RESERVA
accesible, los campos ESTRUCTURADOS de la RESERVA que determinan el precio:
`RESERVA.duracionHoras` (enum `{4, 8, 12}`) y el desglose de invitados
`RESERVA.numAdultosNinosMayores4` (adultos y niños > 4) y `RESERVA.numNinosMenores4` (niños
≤ 4), con la misma semántica y validación que el editor de consulta (fiel al tarifario, que
corta el tramo por `numAdultosNinosMayores4`). Estos campos NO se guardan ya en los campos
operativos sueltos `FICHA_OPERATIVA.duracion` (texto libre) ni `numInvitadosConfirmado`: esos
quedan como columnas legacy no escritas por esta vía. La escritura de `duracionHoras` y del
desglose de invitados se persiste sobre la RESERVA en la MISMA transacción del guardado, bajo
el contexto RLS del tenant, y —cuando el valor cambia respecto al vigente y la RESERVA está en
la ventana viva— dispara el recálculo en cascada (ver deltas `presupuestos`/`facturacion`/
`comunicaciones`). Un `duracionHoras` fuera de `{4,8,12}` o un desglose de invitados negativo
se rechaza (400/422) sin mutar nada. (Fuente: petición de usuario; `US-016 §Reglas de
Validación` duraciones `{4,8,12}`; editor de consulta; `er-diagram.md §3.6 RESERVA`.)

#### Scenario: Guardar una nueva duración estructurada persiste en la RESERVA

- **GIVEN** una RESERVA en `reserva_confirmada` con `duracionHoras = 4` y su ficha operativa
  accesible dentro de la ventana viva
- **WHEN** el Gestor guarda `duracionHoras = 8` desde la ficha
- **THEN** el sistema persiste `RESERVA.duracionHoras = 8` en la misma transacción
- **AND** dispara el recálculo en cascada del precio (nuevo total, restante, presupuesto y
  liquidación regenerados)

#### Scenario: Guardar el desglose de invitados persiste en la RESERVA

- **GIVEN** una RESERVA en `reserva_confirmada` con `numAdultosNinosMayores4 = 40` y
  `numNinosMenores4 = 5` dentro de la ventana viva
- **WHEN** el Gestor guarda `numAdultosNinosMayores4 = 48` y `numNinosMenores4 = 2` desde la
  ficha
- **THEN** el sistema persiste ambos campos en la RESERVA y dispara el recálculo en cascada

#### Scenario: Duración inválida se rechaza sin mutar nada

- **GIVEN** una RESERVA en la ventana viva
- **WHEN** el Gestor intenta guardar `duracionHoras = 6`
- **THEN** el sistema rechaza la operación (400/422) y no modifica la RESERVA ni dispara
  recálculo

### Requirement: Nº de invitados confirmado como campo derivado (no escrito)

El sistema SHALL (DEBE) exponer el "nº de invitados confirmado" de la ficha operativa como un
valor **DERIVADO** de la RESERVA, calculado como
`RESERVA.numInvitadosFinal ?? (RESERVA.numAdultosNinosMayores4 + RESERVA.numNinosMenores4)`
(nulls tratados como 0), reutilizando la regla `derivarNumPersonas` ya usada por presupuestos.
El campo derivado es de **solo lectura**: el Gestor no lo escribe directamente; cambia por el
desglose de invitados (arriba). `FICHA_OPERATIVA.numInvitadosConfirmado` no se escribe por esta
vía (columna legacy). (Fuente: petición de usuario; memoria del proyecto "aforo/personas es
campo derivado"; `derivar-num-personas.ts`.)

#### Scenario: El nº de invitados confirmado refleja el desglose de la RESERVA

- **GIVEN** una RESERVA con `numInvitadosFinal = NULL`, `numAdultosNinosMayores4 = 48` y
  `numNinosMenores4 = 2`
- **WHEN** el Gestor lee la ficha operativa
- **THEN** el nº de invitados confirmado se muestra como `50` (derivado)

#### Scenario: numInvitadosFinal informado tiene prioridad

- **GIVEN** una RESERVA con `numInvitadosFinal = 45`, `numAdultosNinosMayores4 = 40` y
  `numNinosMenores4 = 3`
- **WHEN** el Gestor lee la ficha operativa
- **THEN** el nº de invitados confirmado se muestra como `45`

### Requirement: Pre-relleno completo de la ficha al leer desde RESERVA y CLIENTE

El sistema SHALL (DEBE), al LEER la ficha operativa de una RESERVA accesible, pre-rellenar los
campos que aún no tengan valor propio persistido en la ficha con los datos existentes en la
RESERVA y su CLIENTE, para que el Gestor los encuentre aunque la ficha ya existiera (no solo al
crearla): nº de personas (derivado, ver arriba), Duración desde `RESERVA.duracionHoras`, Hora
desde `RESERVA.horario`, Contacto nombre desde `CLIENTE.nombre` (+ `apellidos`), Teléfono desde
`CLIENTE.telefono`, Correo desde `CLIENTE.email` y Notas desde `RESERVA.comentarios`. El
pre-relleno es de PRESENTACIÓN: leer la ficha NO muta ninguna entidad ni dispara transiciones;
un guardado posterior persiste el valor definitivo (que a partir de entonces prevalece sobre el
derivado). Toda lectura filtra por el `tenant_id` del JWT (RLS). (Fuente: petición de usuario;
change `ficha-operativa-campos-operativos` pre-relleno de correo al crear; `mejoras-detalle-
consulta` siembra de notas; `er-diagram.md §3.6 RESERVA`, `§3.9 CLIENTE`.)

#### Scenario: Ficha ya existente muestra los datos pre-rellenados al leer

- **GIVEN** una RESERVA confirmada cuya FICHA_OPERATIVA se creó antes de este change (con
  `horaLlegada`, `contactoEventoNombre` y `contactoEventoTelefono` a `NULL`) y cuya RESERVA
  tiene `horario = "18:00"` y cuyo CLIENTE tiene `nombre = "Ana"`, `apellidos = "López"`,
  `telefono = "600111222"`
- **WHEN** el Gestor lee la ficha operativa
- **THEN** el sistema muestra la hora pre-rellenada `18:00`, el contacto `Ana López` y el
  teléfono `600111222`, derivados de la RESERVA/CLIENTE
- **AND** no se muta ninguna entidad ni se dispara ninguna transición al leer

#### Scenario: Un valor propio de la ficha prevalece sobre el pre-relleno

- **GIVEN** una FICHA_OPERATIVA con `contactoEventoNombre = "Coordinador de sala"` (valor propio
  guardado por el Gestor) y un CLIENTE con `nombre = "Ana"`
- **WHEN** el Gestor lee la ficha operativa
- **THEN** el sistema muestra `Coordinador de sala` (el valor propio, no el pre-relleno del
  cliente)
