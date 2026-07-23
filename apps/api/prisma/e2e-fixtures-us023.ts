/**
 * FIXTURES para el E2E MANUAL de US-023 (envío/reenvío de factura de señal + condicions
 * particulars por E3, épico #6 rebanada 6.4b + endurecimiento GAP 2).
 *
 * ⚠️ NO es un test. Es un script para poblar la BD de DESARROLLO y poder ejecutar el flujo
 * manualmente (frontend + endpoint) sin depender del seed normal (que NO crea reservas).
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * CÓMO EJECUTARLO
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * El proyecto usa `ts-node` para el seed (ver `package.json` → `prisma.seed`). Este script
 * se ejecuta igual, con la misma DATABASE_URL de desarrollo cargada por entorno:
 *
 *   # Sembrar los fixtures (idempotente: borra por IDs fijos y recrea):
 *   pnpm --filter @slotify/api exec ts-node --compiler-options '{"module":"CommonJS"}' prisma/e2e-fixtures-us023.ts
 *
 *   # (Alternativa con tsx, si está disponible en el entorno):
 *   npx tsx prisma/e2e-fixtures-us023.ts
 *
 *   # Teardown — borra TODOS los fixtures (deja el tenant piloto intacto salvo lo propio):
 *   pnpm --filter @slotify/api exec ts-node --compiler-options '{"module":"CommonJS"}' prisma/e2e-fixtures-us023.ts --teardown
 *   npx tsx prisma/e2e-fixtures-us023.ts --teardown
 *
 *   # También acepta la variable de entorno E2E_TEARDOWN=1 (equivalente a --teardown).
 *
 * Asegúrate de apuntar a la BD de DESARROLLO (NO a slotify_test). Se recomienda ejecutarlo
 * con el mismo `.env` que usa `pnpm dev` (DATABASE_URL de desarrollo).
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * QUÉ CREA (todos los IDs con prefijo reconocible `e2e0…`)
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * Fixture A — reserva del tenant PILOTO con E3 YA enviado (el piloto SÍ tiene condiciones):
 *   objetivo: la ficha muestra el botón "Reenviar E3".
 * Fixture B — reserva de un tenant NUEVO SIN condiciones, factura de señal en `borrador`:
 *   objetivo: al pulsar "Enviar E3" el backend responde 409 CONDICIONES_NO_CONFIGURADAS (GAP 2).
 *
 * Multi-tenancy: `tenant_id` presente en TODAS las filas. La máquina de estados se respeta
 * (ambas reservas en `reserva_confirmada`, estado válido desde el que se envía la señal).
 */
import { PrismaClient, Rol } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────────────────────────────
// IDs FIJOS (prefijo `e2e0…`) — permiten idempotencia (borrar+recrear) y teardown selectivo.
// ─────────────────────────────────────────────────────────────────────────────────────────

// Tenant piloto Masia l'Encís (reutilizado del seed; NO se toca salvo los fixtures propios).
const TENANT_PILOTO_ID = '00000000-0000-0000-0000-000000000001';

// --- Fixture A (tenant piloto, E3 ya enviado) ---
const A_CLIENTE_ID = 'e2e00000-0000-0000-000a-000000000001';
const A_RESERVA_ID = 'e2e00000-0000-0000-000a-000000000002';
const A_FACTURA_ID = 'e2e00000-0000-0000-000a-000000000003';
const A_COMUNICACION_ID = 'e2e00000-0000-0000-000a-000000000004';
const A_DOCUMENTO_ID = 'e2e00000-0000-0000-000a-000000000005';

// --- Fixture B (tenant nuevo SIN condiciones, factura en borrador) ---
const B_TENANT_ID = 'e2e00000-0000-0000-000b-000000000001';
const B_USUARIO_ID = 'e2e00000-0000-0000-000b-000000000002';
const B_CLIENTE_ID = 'e2e00000-0000-0000-000b-000000000003';
const B_RESERVA_ID = 'e2e00000-0000-0000-000b-000000000004';
const B_FACTURA_ID = 'e2e00000-0000-0000-000b-000000000005';

// Credenciales del gestor del tenant B (para loguear y ver su reserva bajo RLS).
const B_GESTOR_EMAIL = 'gestor-e2e-sincond@slotify.test';
const B_GESTOR_PASSWORD = 'Slotify2026!';

// Credenciales del gestor del tenant piloto (referencia; ya existe por el seed).
const PILOTO_GESTOR_EMAIL = 'info@masialencis.com';
const PILOTO_GESTOR_PASSWORD = 'Slotify2026!';

// ─────────────────────────────────────────────────────────────────────────────────────────
// TEARDOWN — borra en orden de dependencias (hijos → padres). Idempotente: usa IDs fijos.
// ─────────────────────────────────────────────────────────────────────────────────────────

const teardown = async (): Promise<void> => {
  // Fixture A (piloto): borrar solo las filas propias, dejar el tenant piloto intacto.
  await prisma.comunicacion.deleteMany({ where: { idComunicacion: A_COMUNICACION_ID } });
  await prisma.documento.deleteMany({ where: { idDocumento: A_DOCUMENTO_ID } });
  await prisma.factura.deleteMany({ where: { idFactura: A_FACTURA_ID } });
  await prisma.reserva.deleteMany({ where: { idReserva: A_RESERVA_ID } });
  await prisma.cliente.deleteMany({ where: { idCliente: A_CLIENTE_ID } });

  // Fixture B: borrar todo, incluido el tenant y su gestor.
  await prisma.factura.deleteMany({ where: { idFactura: B_FACTURA_ID } });
  await prisma.reserva.deleteMany({ where: { idReserva: B_RESERVA_ID } });
  await prisma.cliente.deleteMany({ where: { idCliente: B_CLIENTE_ID } });
  await prisma.usuario.deleteMany({ where: { idUsuario: B_USUARIO_ID } });
  // Por seguridad, barre cualquier resto de negocio del tenant B antes de borrarlo.
  await prisma.plantillaDocumentoTenant.deleteMany({ where: { tenantId: B_TENANT_ID } });
  await prisma.tenantSettings.deleteMany({ where: { tenantId: B_TENANT_ID } });
  await prisma.tenant.deleteMany({ where: { idTenant: B_TENANT_ID } });

  // eslint-disable-next-line no-console
  console.log('Teardown OK — fixtures US-023 eliminados (tenant piloto intacto).');
};

// ─────────────────────────────────────────────────────────────────────────────────────────
// SEED de los fixtures.
// ─────────────────────────────────────────────────────────────────────────────────────────

const seed = async (): Promise<void> => {
  // Idempotencia: primero borramos cualquier estado previo de los fixtures.
  await teardown();

  const passwordHash = await argon2.hash(B_GESTOR_PASSWORD);
  const ahora = new Date('2026-07-15T09:00:00.000Z');
  const fechaEventoA = new Date('2026-11-14'); // sábado, temporada media
  const fechaEventoB = new Date('2026-11-21');

  // ────────────────────────────────────────────────────────────────────────────
  // FIXTURE A — tenant PILOTO, reserva con E3 YA enviado.
  // ────────────────────────────────────────────────────────────────────────────

  await prisma.cliente.create({
    data: {
      idCliente: A_CLIENTE_ID,
      tenantId: TENANT_PILOTO_ID,
      nombre: 'Cliente E2E',
      apellidos: 'Con E3 Enviado',
      email: 'cliente-e2e-con-e3@example.test',
      telefono: '+34 600 111 222',
      dniNif: '12345678Z',
    },
  });

  await prisma.reserva.create({
    data: {
      idReserva: A_RESERVA_ID,
      tenantId: TENANT_PILOTO_ID,
      clienteId: A_CLIENTE_ID,
      codigo: 'E2E-A-0001',
      estado: 'reserva_confirmada',
      canalEntrada: 'email',
      fechaEvento: fechaEventoA,
      duracionHoras: 'h8',
      tipoEvento: 'boda',
      numAdultosNinosMayores4: 40,
      numNinosMenores4: 2,
      numInvitadosFinal: 42,
      importeTotal: '1004.00',
      importeSenal: '401.60',
      importeLiquidacion: '602.40',
      // GAP 1/E3: la reserva ya envió condiciones → botón "Reenviar E3".
      condPartEnviadasFecha: ahora,
      condPartFirmadas: false,
      fianzaEur: '500.00',
      activo: true,
    },
  });

  await prisma.factura.create({
    data: {
      idFactura: A_FACTURA_ID,
      tenantId: TENANT_PILOTO_ID,
      reservaId: A_RESERVA_ID,
      numeroFactura: 'F-2026-9001',
      tipo: 'senal',
      baseImponible: '401.60',
      ivaPorcentaje: '0.00',
      ivaImporte: '0.00',
      total: '401.60',
      concepto: 'Señal 40% — reserva E2E-A-0001',
      // pdf_url NO NULO: la guarda de emisión lo exige (null → 502).
      pdfUrl: 'http://localhost:3000/almacen/facturas/e2e-senal-a.pdf',
      estado: 'enviada',
      fechaEmision: ahora,
    },
  });

  await prisma.comunicacion.create({
    data: {
      idComunicacion: A_COMUNICACION_ID,
      tenantId: TENANT_PILOTO_ID,
      reservaId: A_RESERVA_ID,
      clienteId: A_CLIENTE_ID,
      codigoEmail: 'E3',
      asunto: 'Factura de señal y condicions particulars — Masia l\'Encís',
      cuerpo: 'Adjuntamos la factura de señal (40%) y las condiciones particulares del espacio.',
      destinatarioEmail: 'cliente-e2e-con-e3@example.test',
      estado: 'enviado',
      fechaEnvio: ahora,
      // Envío original (no reenvío): dentro del índice de idempotencia parcial.
      esReenvio: false,
    },
  });

  await prisma.documento.create({
    data: {
      idDocumento: A_DOCUMENTO_ID,
      tenantId: TENANT_PILOTO_ID,
      reservaId: A_RESERVA_ID,
      tipo: 'condiciones_particulares',
      nombreArchivo: 'condicions-particulars.pdf',
      url: 'http://localhost:3000/almacen/condiciones/00000000-0000-0000-0000-000000000001.pdf',
      mimeType: 'application/pdf',
    },
  });

  // ────────────────────────────────────────────────────────────────────────────
  // FIXTURE B — tenant NUEVO SIN condiciones, factura de señal en `borrador`.
  // (SIN fila PlantillaDocumentoTenant ⇒ la config es null ⇒ GenerarPdfCondiciones
  //  degrada a null ⇒ el use-case aborta con 409 CONDICIONES_NO_CONFIGURADAS.)
  // ────────────────────────────────────────────────────────────────────────────

  await prisma.tenant.create({
    data: {
      idTenant: B_TENANT_ID,
      nombre: 'Tenant E2E sin condiciones',
      emailContacto: 'contacto-e2e-sincond@slotify.test',
      telefono: '+34 600 333 444',
      direccion: '—',
      nif: 'B99999999',
      capacidadMaxima: 50,
      activo: true,
    },
  });

  // Settings del tenant B (necesarios para que sus flujos de negocio funcionen; NO se crea
  // PlantillaDocumentoTenant a propósito: esa ausencia es el objetivo del GAP 2).
  await prisma.tenantSettings.create({
    data: {
      tenantId: B_TENANT_ID,
      pctSenal: '40.00',
      fianzaDefaultEur: '500.00',
      ttlConsultaDias: 3,
      ttlPrereservaDias: 7,
      maxDiasProgramarVisita: 7,
      idioma: 'es',
    },
  });

  await prisma.usuario.create({
    data: {
      idUsuario: B_USUARIO_ID,
      tenantId: B_TENANT_ID,
      email: B_GESTOR_EMAIL,
      passwordHash,
      nombre: 'Gestor E2E',
      apellidos: 'Sin Condiciones',
      rol: Rol.gestor,
      activo: true,
    },
  });

  await prisma.cliente.create({
    data: {
      idCliente: B_CLIENTE_ID,
      tenantId: B_TENANT_ID,
      nombre: 'Cliente E2E',
      apellidos: 'Tenant Sin Cond',
      email: 'cliente-e2e-sincond@example.test',
      telefono: '+34 600 555 666',
      dniNif: '87654321X',
    },
  });

  await prisma.reserva.create({
    data: {
      idReserva: B_RESERVA_ID,
      tenantId: B_TENANT_ID,
      clienteId: B_CLIENTE_ID,
      codigo: 'E2E-B-0001',
      estado: 'reserva_confirmada',
      canalEntrada: 'email',
      fechaEvento: fechaEventoB,
      duracionHoras: 'h8',
      tipoEvento: 'corporativo',
      numAdultosNinosMayores4: 30,
      numNinosMenores4: 0,
      numInvitadosFinal: 30,
      importeTotal: '800.00',
      importeSenal: '320.00',
      importeLiquidacion: '480.00',
      // E3 NO enviado todavía: cond_part_enviadas_fecha NULL, sin comunicación, sin documento.
      condPartEnviadasFecha: null,
      condPartFirmadas: false,
      fianzaEur: '500.00',
      activo: true,
    },
  });

  await prisma.factura.create({
    data: {
      idFactura: B_FACTURA_ID,
      tenantId: B_TENANT_ID,
      reservaId: B_RESERVA_ID,
      numeroFactura: null, // borrador: aún sin número fiscal asignado.
      tipo: 'senal',
      baseImponible: '320.00',
      ivaPorcentaje: '0.00',
      ivaImporte: '0.00',
      total: '320.00',
      concepto: 'Señal 40% — reserva E2E-B-0001',
      // pdf_url presente: para que la guarda 502 NO se dispare y el flujo llegue a la
      // guarda de condiciones (409 CONDICIONES_NO_CONFIGURADAS).
      pdfUrl: 'http://localhost:3000/almacen/facturas/e2e-senal-b.pdf',
      estado: 'borrador',
      fechaEmision: null,
    },
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Resumen por consola (IDs + credenciales + valores previos para restaurar).
  // ────────────────────────────────────────────────────────────────────────────
  /* eslint-disable no-console */
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log(' FIXTURES US-023 SEMBRADOS OK');
  console.log('══════════════════════════════════════════════════════════════════');
  console.log('\n── Fixture A (tenant PILOTO, E3 ya enviado → botón "Reenviar E3") ──');
  console.log(`RESERVA_ID_CON_E3=${A_RESERVA_ID}`);
  console.log(`  codigo=E2E-A-0001  estado=reserva_confirmada  tenant=${TENANT_PILOTO_ID}`);
  console.log(`  factura=${A_FACTURA_ID} (senal/enviada, F-2026-9001)`);
  console.log(`  comunicacion=${A_COMUNICACION_ID} (E3/enviado, es_reenvio=false)`);
  console.log(`  documento=${A_DOCUMENTO_ID} (condiciones_particulares)`);
  console.log(`  cliente=${A_CLIENTE_ID}`);
  console.log(`  login gestor piloto: ${PILOTO_GESTOR_EMAIL} / ${PILOTO_GESTOR_PASSWORD}`);
  console.log('\n── Fixture B (tenant SIN condiciones → 409 CONDICIONES_NO_CONFIGURADAS) ──');
  console.log(`RESERVA_ID_TENANT_SIN_COND=${B_RESERVA_ID}`);
  console.log(`  codigo=E2E-B-0001  estado=reserva_confirmada  tenant=${B_TENANT_ID}`);
  console.log(`  factura=${B_FACTURA_ID} (senal/borrador, sin numero)`);
  console.log(`  (SIN comunicacion E3, SIN documento condiciones, SIN plantilla_documento_tenant)`);
  console.log(`  cliente=${B_CLIENTE_ID}`);
  console.log(`  login gestor tenant B: ${B_GESTOR_EMAIL} / ${B_GESTOR_PASSWORD}`);
  console.log('\n── Para restaurar / limpiar: ejecuta este script con --teardown ──');
  console.log('   (Fixture A borra solo sus filas; Fixture B borra el tenant B completo.)');
  console.log('══════════════════════════════════════════════════════════════════\n');
  /* eslint-enable no-console */
};

// ─────────────────────────────────────────────────────────────────────────────────────────
// Entrada: --teardown / E2E_TEARDOWN → limpiar; en otro caso → sembrar.
// ─────────────────────────────────────────────────────────────────────────────────────────

const esTeardown =
  process.argv.includes('--teardown') || process.env.E2E_TEARDOWN === '1';

const run = esTeardown ? teardown : seed;

run()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
