/**
 * Adaptador Prisma del puerto `CargarDatosDocumentoFacturaPort` (épico #6, 6.3, design.md §D3)
 * — INFRAESTRUCTURA de `facturacion`.
 *
 * Une `Factura → Reserva → Presupuesto(estado=aceptado) → Cliente` y carga la
 * `PlantillaDocumentoTenant` del tenant, todo bajo el RLS del tenant (`fijarTenant` dentro de
 * `$transaction`). Devuelve la CONFIG del tenant (VO de `documentos`), el `numeroPresupuesto` y
 * el `regimenIva` del presupuesto aceptado (CON IVA por defecto si no hay presupuesto o régimen
 * NULL) y los datos fiscales del CLIENTE (receptor). Los Decimal no intervienen aquí.
 */
import { Injectable } from '@nestjs/common';
import type { PlantillaDocumentoTenant } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  CondicionesDocumento,
  ConfiguracionDocumentoTenant,
} from '../../documentos/domain/configuracion-documento';
import type {
  CargarDatosDocumentoFacturaPort,
  DatosDocumentoFactura,
} from '../domain/cargar-datos-documento-factura.port';

/** Mapea la fila `plantilla_documento_tenant` al VO `ConfiguracionDocumentoTenant`. */
const aConfiguracion = (
  fila: PlantillaDocumentoTenant,
): ConfiguracionDocumentoTenant => ({
  tenantId: fila.tenantId,
  branding: {
    logoUrl: fila.logoUrl,
    colorPrimario: fila.colorPrimario,
    colorTexto: fila.colorTexto,
  },
  identidadFiscal: {
    razonSocialFiscal: fila.razonSocialFiscal,
    nombreComercial: fila.nombreComercial,
    nif: fila.nif,
    direccionFiscal: fila.direccionFiscal,
    web: fila.web,
    email: fila.email,
  },
  banca: {
    iban: fila.iban,
    beneficiarioTransferencia: fila.beneficiarioTransferencia,
    conceptoTransferencia: fila.conceptoTransferencia,
  },
  textos: {
    plantillaConceptoFiscal: {
      ca: fila.plantillaConceptoFiscalCa,
      es: fila.plantillaConceptoFiscalEs,
    },
    validesaTexto: { ca: fila.validesaTextoCa, es: fila.validesaTextoEs },
    pieLegal: { ca: fila.pieLegalCa, es: fila.pieLegalEs },
  },
  // Épico #6 6.4a: la factura no pinta condicions, pero el VO las requiere; se mapea la
  // columna JSON (default `'{}'`) tolerando filas sin poblar.
  condiciones: aCondiciones(fila.condiciones),
});

/** Mapea la columna JSON `condiciones` al bloque del VO (tolera filas sin poblar). */
const aCondiciones = (
  valor: PlantillaDocumentoTenant['condiciones'],
): CondicionesDocumento => {
  const bruto = (valor ?? {}) as Partial<CondicionesDocumento>;
  return {
    titulo: bruto.titulo ?? { ca: '', es: '' },
    secciones: Array.isArray(bruto.secciones) ? bruto.secciones : [],
  };
};

@Injectable()
export class CargarDatosDocumentoFacturaPrismaAdapter
  implements CargarDatosDocumentoFacturaPort
{
  constructor(private readonly prisma: PrismaService) {}

  readonly cargar = async (
    idFactura: string,
    tenantId: string,
  ): Promise<DatosDocumentoFactura> => {
    const datos = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, tenantId);
      const factura = await tx.factura.findFirst({
        where: { idFactura, tenantId },
        select: {
          tipo: true,
          numeroFactura: true,
          fechaEmision: true,
          baseImponible: true,
          ivaPorcentaje: true,
          ivaImporte: true,
          total: true,
          reservaExtras: {
            select: {
              subtotal: true,
              conceptoLibre: true,
              extra: { select: { nombre: true } },
            },
          },
          reserva: {
            select: {
              idioma: true,
              cliente: {
                select: {
                  nombre: true,
                  apellidos: true,
                  dniNif: true,
                  direccion: true,
                  codigoPostal: true,
                  poblacion: true,
                  provincia: true,
                  email: true,
                },
              },
              presupuestos: {
                where: { estado: 'aceptado' },
                select: { numeroPresupuesto: true, regimenIva: true },
                take: 1,
              },
            },
          },
        },
      });
      const plantilla = await tx.plantillaDocumentoTenant.findUnique({
        where: { tenantId },
      });
      return { factura, plantilla };
    });

    if (datos.factura === null) {
      throw new Error(`Factura ${idFactura} no encontrada para el tenant`);
    }
    if (datos.plantilla === null) {
      throw new Error(`Configuración de documento no encontrada para el tenant ${tenantId}`);
    }

    const { factura } = datos;
    const cliente = factura.reserva.cliente;
    const presupuesto = factura.reserva.presupuestos[0] ?? null;
    return {
      configuracion: aConfiguracion(datos.plantilla),
      tipo: factura.tipo,
      numeroFactura: factura.numeroFactura,
      fechaEmision: factura.fechaEmision,
      numeroPresupuesto: presupuesto?.numeroPresupuesto ?? null,
      regimenIva: presupuesto?.regimenIva === 'sin_iva' ? 'sin_iva' : 'con_iva',
      idioma: factura.reserva.idioma,
      cliente: {
        nombre: cliente.nombre,
        apellidos: cliente.apellidos ?? '',
        dniNif: cliente.dniNif,
        direccion: cliente.direccion,
        codigoPostal: cliente.codigoPostal,
        poblacion: cliente.poblacion,
        provincia: cliente.provincia,
        email: cliente.email ?? '',
      },
      extras: factura.reservaExtras.map((linea) => ({
        descripcion: linea.conceptoLibre ?? linea.extra?.nombre ?? 'Extra',
        subtotal: linea.subtotal.toFixed(2),
      })),
      desglose: {
        baseImponible: factura.baseImponible.toFixed(2),
        ivaPorcentaje: factura.ivaPorcentaje.toFixed(2),
        ivaImporte: factura.ivaImporte.toFixed(2),
        total: factura.total.toFixed(2),
      },
    };
  };
}
