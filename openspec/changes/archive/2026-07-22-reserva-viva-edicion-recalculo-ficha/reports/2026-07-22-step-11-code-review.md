# Code Review - reserva-viva-edicion-recalculo-ficha
Fecha: 2026-07-22
Agente: code-reviewer (solo lectura)

## Resumen
El recalculo en cascada de la reserva viva respeta los guardrails duros (hexagonal, sin locks distribuidos, importe_senal intocable, guarda declarativa en maquina-estados.ts, read path completo). Se detecta un bug funcional ALTO: el email E9 declara un adjunto presupuesto REQUERIDO pero el disparador no adjunta ningun PDF, por lo que E9 nunca se envia (adjunto_no_disponible), incumpliendo el requisito de la spec comunicaciones.

## Checklist

### Arquitectura hexagonal
- OK maquina-estados.ts y recalcular-reserva-viva.use-case.ts no importan @nestjs, Prisma ni infrastructure. El use-case solo depende de puertos inyectados.
- OK RecalcularReservaVivaUseCase vive en application/ y opera solo sobre puertos (motorTarifa, unidadDeTrabajo, cargarReserva, dispararE9).
- OK Adaptadores Prisma (UoW, carga, motor, E9) en infrastructure/.

### Bloqueo atomico de fecha
- OK Sin Redis/Redlock/lock distribuido en el use-case ni adaptadores.
- OK Idempotencia por unicidad unique(reservaId, version) + reintento acotado (MAX_REINTENTOS_VERSION=10) ante P2002 (esColisionVersion).

### Invariante importe_senal
- OK recongelarImportes NO escribe importe_senal (solo importeTotal e importeLiquidacion). El comentario explicita la invariante.
- OK No aparece importe_senal en ningun update de escritura. El pagoInicial de la nueva version de presupuesto se fija al importe_senal congelado (no lo recalcula).
- OK Test de integracion 3.6-A asegura importe_senal intacto tras recalculo.

### Guarda declarativa
- OK esEditableEnVentanaViva es funcion pura en maquina-estados.ts (reserva_confirmada AND preEventoStatus != cerrado AND liquidacionStatus != cobrada).
- OK Se re-evalua DENTRO de la tx con lectura fresca (ejecutarTransaccion paso a), no solo antes de abrir la tx.
- OK FueraDeVentanaVivaError con codigo fuera_de_ventana_viva; controlador mapea a 422 (verificado en curl step-8).

### Read path completo
- OK JOIN a CLIENTE en cargar-reserva-con-ficha.prisma.adapter.ts (nombre/apellidos/email/telefono).
- OK Campos derivados (pre-relleno) calculados en leer-ficha-operativa.use-case.ts, no en el adaptador.
- OK duracionHoras, numAdultosNinosMayores4, numNinosMenores4 recorren projection, puerto, use-case, DTO, contrato.
- OK numInvitadosConfirmado se expone read-only derivado (derivarNumPersonas); el guardado no lo escribe como aforo estructural.

### Arrow functions
- OK Helpers/factories fuera de clases usan arrow functions. Metodos de clase NestJS exentos. Sin function declarativo nuevo.

### Multi-tenancy / RLS
- OK Escrituras nuevas (PRESUPUESTO version, FACTURA regenerada, RESERVA, AUDIT_LOG) llevan tenant_id.
- OK La UoW ejecuta fijarTenant(tx, tenantId) (SET LOCAL app.tenant_id) como primera operacion; carga y E9 tambien.
- Nota: filtro tenant_id en el WHERE (defensa en profundidad; RLS no aplica a superuser en dev/test, deuda conocida del proyecto).

### Soft-deprecate
- OK numInvitadosConfirmado y duracion (texto) marcados deprecated en el DTO; el guardado estructural no los usa como fuente de aforo/duracion.
- OK Campos legacy siguen en el schema (migracion aditiva: solo anade presupuesto.origen y el valor de enum E9).

### Email E9
- OK renderE9/renderE9Ca registrados en catalogo-plantillas.ts (E9 ACTIVA es/ca).
- OK Fallback a es para idioma no soportado (seleccionar E9 fr devuelve null).
- OK Disparo post-commit en RecalcularReservaVivaUseCase.ejecutar (fuera de la tx); best-effort, un fallo no revierte la tx.
- FALLO Adjunto: PLANTILLA_E9_ES/CA declaran adjuntosRequeridos [presupuesto], pero DispararE9Adapter.disparar NO pasa adjuntos a motor.despachar. Ver Hallazgo 1.

### Tests
- OK Tests RED presentes: recalcular-reserva-viva.use-case.spec.ts, recalcular-reserva-viva-integracion.spec.ts, maquina-estados-ventana-viva.spec.ts, catalogo-plantillas-e9.spec.ts, derivar-num-personas.spec.ts, pre-relleno.
- OK El test de integracion NO siembra importe_total con el valor post-recalculo (baseline 3000, asserta que el recalculo escribe 5000).
- OK La suite de integracion usa BD real (no mocks de Prisma).

### Frontend
- OK components/ solo contiene .tsx; helpers/tipos/schemas en lib/ y model/.
- OK Barrel index.ts exporta la API publica correctamente.
- OK api-client/schema.d.ts es auto-generado (cabecera openapi-typescript), no editado a mano.
- OK Mobile-first: BloquePrecioManual input full-width en movil (sm:max-w-xs), AvisoRecalculo responsive; sin anchos px fijos. Capturas E2E 390/768/1280 aportadas.

## Hallazgos

### Hallazgo 1 - [ALTA] El email E9 nunca se envia: adjunto requerido no aportado
- Ubicacion: apps/api/src/ficha-evento/infrastructure/disparar-e9.adapter.ts:41-56 vs apps/api/src/comunicaciones/infrastructure/plantillas/catalogo-plantillas.ts:407-424.
- Regla violada: spec-delta comunicaciones (envia la COMUNICACION con el PDF del presupuesto de modificacion adjunto) + design D-6.
- Detalle: PLANTILLA_E9_ES/CA declaran adjuntosRequeridos [presupuesto]. En DespacharEmailService.despachar (paso 6), un adjunto requerido ausente o con pdfUrl nulo retorna motivo adjunto_no_disponible SIN enviar. DispararE9Adapter solo pasa variablesExtra; no genera ni adjunta el PDF. Resultado: E9 nunca se envia. Es el patron de la memoria E2 fallido/plantilla inactiva y adjunto por URL/Buffer.
- Cobertura: el step-8 (curl) NO verifico el envio real de E9; los tests de catalogo cubren solo el render, no el despacho con adjunto, por eso el bug quedo oculto.
- Recomendacion: generar/adjuntar el PDF del presupuesto de modificacion en el disparador (patron E2/E3), o si el PDF se difiere bajar E9 a adjuntosRequeridos vacio de forma explicita y documentarlo en design D-6. No dejar un adjunto requerido que nadie aporta.

### Hallazgo 2 - [MEDIA] Orden recalculo-ficha: el recalculo commitea (y dispara E9) antes del guardado de la ficha
- Ubicacion: apps/api/src/ficha-evento/application/guardar-ficha-operativa.use-case.ts:117-151.
- Detalle: recalcularSiProcede ejecuta el RecalcularReservaVivaUseCase completo (su propia tx + commit + disparo E9) ANTES de abrir la UoW del guardado de campos operativos. Si la tx del guardado de ficha fallara, el recalculo ya esta commiteado y el E9 ya despachado: no hay atomicidad extremo a extremo. Son dos transacciones independientes.
- Valoracion: aceptable como diseno (el recalculo es la mutacion critica e idempotente; el guardado operativo es secundario), pero conviene dejarlo explicito. No bloqueante.
- Recomendacion: documentar en design que recalculo y guardado operativo son transacciones separadas; o reordenar para guardar operativos antes del recalculo si se quiere que un fallo del guardado impida el recalculo.

### Hallazgo 3 - [BAJA] numeroADuracionHoras degrada valores no 4/8/12 a h8 silenciosamente
- Ubicacion: apps/api/src/ficha-evento/infrastructure/recalculo-viva-uow.prisma.adapter.ts:39-48.
- Detalle: el default del switch mapea cualquier duracion distinta de 4/12 a h8. El DTO ya valida IsIn 4/8/12 (400 antes de llegar aqui), riesgo real nulo hoy, pero el fallback silencioso podria enmascarar datos corruptos si se invocara desde otra via sin validacion.
- Recomendacion: lanzar en el default o restringir el tipo de entrada; menor.

## Veredicto: APTO

Los guardrails DUROS pasan: arquitectura hexagonal intacta, sin locks distribuidos, importe_senal nunca mutado, guarda declarativa re-evaluada bajo tx, read path completo y multi-tenancy/RLS correctos. No hay hallazgo Bloqueante. El Hallazgo 1 (ALTA) es un bug funcional real del envio de E9 que DEBE corregirse (o el adjunto se aporta, o E9 pasa a adjuntosRequeridos vacio documentado), pero no viola un guardrail arquitectonico duro. Se recomienda resolver el Hallazgo 1 antes del gate humano final; los Hallazgos 2 y 3 son deuda documentable.
