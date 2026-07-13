# Step 8 — QA E2E con Playwright MCP

**Change:** presupuesto-datos-fiscales-cliente-inline (US-014, incidencia #5, Parte B)
**Fecha:** 2026-07-13
**Servidores:** Web http://localhost:5173 | API http://localhost:3000/api | BD slotify_dev

---

## 8.1 Estado inicial de BD (baseline)

| Campo | Reserva usada | Valor antes del E2E |
|---|---|---|
| reserva_id | d1f92f88-00a5-4f9d-8989-dd8fc661878a | — |
| estado | consulta | consulta |
| subEstado | 2b | 2b |
| duracionHoras | — | 8 (horas validas para generar presupuesto) |
| cliente.dniNif | — | NULL |
| cliente.direccion | — | NULL |
| cliente.codigoPostal | — | NULL |
| cliente.poblacion | — | NULL |
| cliente.provincia | — | NULL |

Nota: la reserva 976f45c4-dfd6-4d14-af0f-62e85adb66ac (26-0003) tiene `duracionHoras=null`
lo que produce un 422 "La duracion debe ser 4, 8 o 12 horas" al abrir el dialogo preview,
impidiendo provocar el flujo DATOS_FISCALES_INCOMPLETOS. Se uso la reserva d1f92f88 (26-0001)
que tiene duracionHoras=8 y datos fiscales a null.

---

## 8.2 Flujo DATOS_FISCALES_INCOMPLETOS — resultado

**Paso:** Login como gestor (info@masialencis.com), navegar a la ficha de la reserva
d1f92f88 (Consulta 26-0001), clic "Generar presupuesto", clic "Confirmar presupuesto"
con los 5 campos fiscales vacios.

**Resultado:** PASS

- La UI realizo el PATCH de datos fiscales (body vacio → no se envio PATCH), luego
  llamo a POST /presupuesto y recibio 422 con codigo DATOS_FISCALES_INCOMPLETOS.
- Se mostro alert en la cabecera del dialogo:
  "Faltan datos para generar el presupuesto: dniNif, direccion, codigoPostal, poblacion, provincia"
  con lista de 5 campos humanizados.
- Los 5 inputs quedaron con `aria-invalid="true"` y borde/anillo rojo.
- El foco salto al primer campo faltante: "DNI / NIF" (input activo confirmado en snapshot).
- Cada input mostro mensaje de error: "Completa este dato fiscal del cliente."

Captura: `e2e-screenshots/03-datos-fiscales-incompletos-resaltados-1280.png`

---

## 8.3 Completar datos fiscales y confirmar presupuesto — resultado

**Datos introducidos:**
- DNI / NIF: 12345678A
- Direccion: Calle Mayor 1, Local 2
- Codigo postal: 08001
- Poblacion: Barcelona
- Provincia: Barcelona

**Paso:** Rellenar los 5 campos → clic "Confirmar presupuesto"

**Resultado:** PASS

El flujo del dialogo:
1. Invoco `guardar()` del handle imperativo de `DatosFiscalesClienteSection`.
2. PATCH /reservas/d1f92f88.../datos-fiscales → 200 OK (persistio los 5 campos).
3. `setCamposResaltados([])` limpio el resaltado.
4. POST /reservas/d1f92f88.../presupuesto → 201 Created.
5. El dialogo se cerro automaticamente.
6. La ficha mostro un banner de exito (role="status"):
   "Presupuesto generado. La reserva ha pasado a pre-reserva con un bloqueo de fecha de 7 dias."
   "Total del presupuesto: 1076,00 EUR (IVA 21% incluido). Se ha enviado el email al cliente con el presupuesto adjunto."
7. Las Acciones de la ficha cambiaron: desaparecio "Generar presupuesto", aparecio
   "Confirmar pago de senal" — confirmando la transicion de estado a pre_reserva.

Captura: `e2e-screenshots/04-datos-fiscales-rellenos-1280.png`
Captura: `e2e-screenshots/05-presupuesto-confirmado-1280.png`

---

## 8.4 Responsive — resultados por viewport

### Viewport 390px (movil)

| Comprobacion | Resultado |
|---|---|
| Overflow horizontal | NINGUNO (bodyScrollWidth=375px <= 390px) |
| Dialog visible y contenido | SI (dialogScrollWidth=341px) |
| Campos fiscales en 1 columna | SI (grid colapsa a 1 columna en movil) |
| Hamburger/toggle visible | SI (btn "Abrir navegacion" visible) |
| Sidebar lateral | CERRADO por defecto (drawer universal) |
| Altura inputs | 48px (> 44px minimo tactil) |

Captura: `e2e-screenshots/08-ficha-390.png`
Captura: `e2e-screenshots/09-dialog-datos-fiscales-390.png`

### Viewport 768px (tablet)

| Comprobacion | Resultado |
|---|---|
| Overflow horizontal | NINGUNO (bodyScrollWidth=753px <= 768px) |
| Dialog visible y contenido | SI (dialogScrollWidth=670px) |
| Campos fiscales en 2 columnas | SI (gridTemplateColumns="303px 303px") |
| Hamburger/toggle visible | SI (768 < lg:1024px, drawer activo) |
| Altura inputs | 48px |

Captura: `e2e-screenshots/10-ficha-768.png`
Captura: `e2e-screenshots/11-dialog-datos-fiscales-768.png`

### Viewport 1280px (escritorio)

| Comprobacion | Resultado |
|---|---|
| Overflow horizontal | NINGUNO (bodyScrollWidth=1265px <= 1280px) |
| Dialog visible y contenido | SI (dialogScrollWidth=655px, max-w-2xl) |
| Campos fiscales en 2 columnas | SI (gridTemplateColumns="295.5px 295.5px") |
| Sidebar lateral | Visible (nav display=flex, width=288px) |
| Altura inputs | 48px |
| Altura botones CTA | 48px |

Captura: `e2e-screenshots/01-ficha-reserva-1280.png`
Captura: `e2e-screenshots/02-dialog-abierto-1280.png`
Captura: `e2e-screenshots/12-dialog-datos-fiscales-1280.png`

Nota de diseno: el AppShell implementa un patron de drawer universal (el sidebar
empieza cerrado a todos los anchos y se abre con el icono del logo). A 1280px la nav
es visible (flex, ancho 288px) cuando esta abierta. Esto difiere del spec CLAUDE.md
que dice "sidebar fijo en >=lg", pero el patron elegido es consistente, esta testeado
y aceptado en los tests de AppShellResponsive.test.tsx.

---

## 8.5 Persistencia — verificacion via API

Tras la confirmacion del presupuesto se verifico el estado de la reserva d1f92f88
mediante curl con token de gestor:

```
GET /api/reservas/d1f92f88-00a5-4f9d-8989-dd8fc661878a
```

Campos verificados en la respuesta:

| Campo | Valor esperado | Valor en BD |
|---|---|---|
| estado | pre_reserva | pre_reserva |
| cliente.dniNif | 12345678A | 12345678A |
| cliente.direccion | Calle Mayor 1, Local 2 | Calle Mayor 1, Local 2 |
| cliente.codigoPostal | 08001 | 08001 |
| cliente.poblacion | Barcelona | Barcelona |
| cliente.provincia | Barcelona | Barcelona |

Resultado: PASS — todos los campos coinciden con lo introducido en el formulario.

---

## Estado final de la BD (para restauracion manual)

El agente NO puede restaurar la BD (sin acceso fiable a Postgres desde el subagente).
El desarrollador debe restaurar manualmente:

**Reserva d1f92f88-00a5-4f9d-8989-dd8fc661878a (Consulta 26-0001):**
- `estado`: paso de `consulta` a `pre_reserva` — NECESITA RESTAURACION
- Se genero un PRESUPUESTO asociado — NECESITA BORRADO
- Se creo un bloqueo de fecha de 7 dias (FECHA_BLOQUEADA o TTL) — NECESITA RESTAURACION

**Cliente asociado a la reserva d1f92f88 (Jatinder Halipa):**
- `dni_nif`: NULL → "12345678A" — NECESITA RESTAURACION a NULL
- `direccion`: NULL → "Calle Mayor 1, Local 2" — NECESITA RESTAURACION a NULL
- `codigo_postal`: NULL → "08001" — NECESITA RESTAURACION a NULL
- `poblacion`: NULL → "Barcelona" — NECESITA RESTAURACION a NULL
- `provincia`: NULL → "Barcelona" — NECESITA RESTAURACION a NULL

**Reserva 976f45c4-dfd6-4d14-af0f-62e85adb66ac (Consulta 26-0003):**
- No modificada (dialog se abrio pero se cerro sin confirmar; el PATCH de datos
  fiscales no se llego a enviar porque el boton "Confirmar" estaba deshabilitado
  por el error de duracion)

---

## Capturas generadas

Todas las capturas se guardaron directamente en
`openspec/changes/presupuesto-datos-fiscales-cliente-inline/reports/e2e-screenshots/`
(no se dejaron en la raiz del repo).

| Archivo | Descripcion |
|---|---|
| 01-ficha-reserva-1280.png | Ficha 26-0001 en 1280px antes de abrir dialogo |
| 02-dialog-abierto-1280.png | Dialogo abierto con desglose calculado en 1280px |
| 03-datos-fiscales-incompletos-resaltados-1280.png | Campos fiscales resaltados tras DATOS_FISCALES_INCOMPLETOS |
| 04-datos-fiscales-rellenos-1280.png | Campos rellenos antes de confirmar |
| 05-presupuesto-confirmado-1280.png | Banner de exito tras confirmar (estado pre_reserva) |
| 06-ficha-prereserva-390.png | Ficha d1f92f88 en pre_reserva a 390px |
| 07-login-390.png | Pantalla de login a 390px (layout movil) |
| 08-ficha-390.png | Ficha 26-0003 a 390px |
| 09-dialog-datos-fiscales-390.png | Dialogo datos fiscales a 390px (1 columna) |
| 10-ficha-768.png | Ficha 26-0003 a 768px |
| 11-dialog-datos-fiscales-768.png | Dialogo datos fiscales a 768px (2 columnas) |
| 12-dialog-datos-fiscales-1280.png | Dialogo datos fiscales a 1280px (2 columnas, sidebar visible) |

---

## Incidencias encontradas

1. **Reserva 976f45c4 con duracionHoras=null**: esta reserva (26-0003, la mencionada
   en primer lugar en las instrucciones de QA) tiene `duracionHoras=null` lo que
   provoca un 422 "La duracion debe ser 4, 8 o 12 horas" en el preview, bloqueando
   el flujo DATOS_FISCALES_INCOMPLETOS. Se uso la reserva d1f92f88 (26-0001) que
   tenia duracionHoras=8 y datos fiscales a null. La reserva 976f45c4 sigue sin
   cambios (no modificada).
   Severidad: BAJA (dato de seed incorrecto, no un bug de la feature).

2. **Dialogo X (Cerrar) a 28px**: el boton de cierre de shadcn/ui DialogClose mide
   28x28px, por debajo del minimo WCAG AA de 44px para objetivos tactiles. El dialogo
   se puede cerrar tambien con "Cancelar" (48px) y con Escape.
   Severidad: MUY BAJA (comportamiento estandar de shadcn/ui, no especifico de este change).

3. **Sidebar universal drawer (no fijo en >=lg)**: el AppShell implementa un drawer
   universal; el sidebar no se fija automaticamente a 1280px. Esto es intencionado
   segun los tests existentes (AppShellResponsive.test.tsx). El sidebar es accesible
   y funcional en todos los viewports.
   Severidad: INFORMATIVO (decision de diseno preexistente, no regresion de este change).

---

## Outcome

**PASS** — Los pasos 8.1-8.6 se completan con exito:

- 8.1 PASS: BD en estado conocido con CLIENTE con datos fiscales incompletos
- 8.2 PASS: DATOS_FISCALES_INCOMPLETOS provoca resaltado de 5 campos con aria-invalid,
  borde rojo y foco en el primero
- 8.3 PASS: Completar datos fiscales y confirmar presupuesto → transicion a pre_reserva
- 8.4 PASS: Sin overflow horizontal en 390/768/1280; inputs 48px; 2 columnas a >=sm
- 8.5 PASS: BD persiste correctamente los 5 campos y el nuevo estado; capturas en
  reports/e2e-screenshots/ (no en raiz)
- 8.6 PASS: Este report creado
