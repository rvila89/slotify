# Spec Delta — Capability `comunicaciones`

> **mejoras-detalle-consulta** (Mejora 3) — Cuando el gestor envía MANUALMENTE el borrador
> E1 desde la ficha, la UI debe quedar coherente sin recargar: invalidar también la query de
> la RESERVA (no solo la de comunicaciones) para que `tieneBorradorE1Pendiente` se recalcule
> y las acciones se desbloqueen, y mostrar un aviso de éxito ARRIBA de la ficha con scroll al
> inicio, replicando la UX del E1 automático. Es una mejora de **frontend**: NO cambia el
> contrato ni el comportamiento de servidor del envío del borrador (US-046).
>
> Fuente: `US-046`; `useEnviarBorrador.ts`; spec viva `comunicaciones` "Confirmación de
> envío de un borrador con edición opcional de asunto y cuerpo"; spec viva `consultas`
> "Las acciones de la consulta se bloquean mientras el E1 sigue en borrador";
> `NuevaConsulta/components/AvisosResultado.tsx`.

## ADDED Requirements

### Requirement: El envío manual de un borrador refresca la ficha de la RESERVA sin recargar

El sistema SHALL (DEBE), cuando el gestor **envía manualmente con éxito** un borrador desde
la ficha de la RESERVA (`RevisarEnviarBorradorDialog` → mutación de envío), invalidar en el
cliente **tanto la query del listado de comunicaciones de la RESERVA como la query de la
propia RESERVA** (`reservaQueryKey`), de modo que el flag derivado
`tieneBorradorE1Pendiente` se **recalcule** y el bloque de acciones de la consulta vuelva a
estar disponible **sin que el gestor tenga que salir y volver a entrar** en la ficha ni
recargar la página. Además, tras el éxito el sistema DEBE mostrar un **aviso de éxito
posicionado arriba de la ficha** (banner con el mismo patrón visual que el aviso del E1
automático de `AvisosResultado.tsx`) y hacer **scroll al inicio** de la página para que el
gestor lo vea, replicando la UX del auto-envío. Este comportamiento es de **frontend** (no
altera el contrato ni el efecto de servidor del envío, definidos en US-046) y aplica al
envío manual de cualquier borrador desde la ficha, con el E1 como caso principal. (Fuente:
`US-046`; `useEnviarBorrador.ts`; spec viva `consultas` "Las acciones de la consulta se
bloquean mientras el E1 sigue en borrador"; `NuevaConsulta/components/AvisosResultado.tsx`.)

#### Scenario: Enviar el borrador E1 desbloquea las acciones sin recargar

- **GIVEN** una RESERVA en sub-estado de consulta con un E1 en `borrador`, cuyas acciones
  están ocultas y con el aviso "Revisa y envía el correo de confirmación antes de continuar."
- **WHEN** el gestor revisa y envía el borrador E1 con éxito desde la ficha
- **THEN** el cliente invalida la query de comunicaciones **y** la query de la RESERVA
  (`reservaQueryKey`)
- **AND** `tieneBorradorE1Pendiente` pasa a `false` y el bloque de acciones vuelve a
  renderizarse sin que el gestor salga de la ficha ni recargue

#### Scenario: Un aviso de éxito aparece arriba de la ficha con scroll al inicio

- **GIVEN** una RESERVA con un E1 en `borrador`
- **WHEN** el gestor envía el borrador E1 con éxito
- **THEN** la ficha muestra un banner de éxito arriba (mismo patrón que el aviso del E1
  automático)
- **AND** la página hace scroll al inicio para que el aviso quede visible

#### Scenario: Un envío fallido no muestra el aviso de éxito ni desbloquea por error

- **GIVEN** una RESERVA con un E1 en `borrador`
- **WHEN** el envío del borrador falla (p. ej. destinatario inválido o fallo del proveedor)
- **THEN** el sistema no muestra el banner de éxito
- **AND** la ficha refleja el estado real de servidor tras el fallo (el E1 sigue en
  `borrador` si no se intentó, o pasa a `fallido` según US-046), manteniendo la coherencia
  de las acciones
