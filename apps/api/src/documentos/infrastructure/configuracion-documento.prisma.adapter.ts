/**
 * Adaptador Prisma del puerto `ConfiguracionDocumentoRepositoryPort` (épico #6,
 * rebanada 6.1a `documentos-config-tenant-storage`).
 *
 * Lee la fila `plantilla_documento_tenant` del tenant y la mapea al VO de
 * dominio `ConfiguracionDocumentoTenant` (cuatro bloques). Lectura pura bajo el
 * RLS del tenant: fija `app.tenant_id` dentro de la transacción y filtra por
 * `tenantId`, igual patrón que el resto de adaptadores Prisma del proyecto.
 */
import { Injectable } from '@nestjs/common';
import type { PlantillaDocumentoTenant } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { ConfiguracionDocumentoRepositoryPort } from '../domain/configuracion-documento.repository.port';
import type {
  CondicionesDocumento,
  ConfiguracionDocumentoTenant,
} from '../domain/configuracion-documento';

@Injectable()
export class ConfiguracionDocumentoPrismaAdapter
  implements ConfiguracionDocumentoRepositoryPort
{
  constructor(private readonly prisma: PrismaService) {}

  async obtenerPorTenant(
    tenantId: string,
  ): Promise<ConfiguracionDocumentoTenant | null> {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, tenantId);
      return tx.plantillaDocumentoTenant.findUnique({ where: { tenantId } });
    });
    return fila ? this.aDominio(fila) : null;
  }

  private aDominio(
    fila: PlantillaDocumentoTenant,
  ): ConfiguracionDocumentoTenant {
    return {
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
        validesaTexto: {
          ca: fila.validesaTextoCa,
          es: fila.validesaTextoEs,
        },
        pieLegal: {
          ca: fila.pieLegalCa,
          es: fila.pieLegalEs,
        },
      },
      condiciones: this.aCondiciones(fila.condiciones),
    };
  }

  /**
   * Mapea la columna JSON `condiciones` (épico #6, 6.4a; bilingüe en
   * `pdf-presupuesto-horario-idioma`) al bloque del VO. La columna es `Json` (default
   * `'{}'`): tolera filas sin poblar devolviendo un bloque vacío con secciones `[]` (la
   * degradación a `null` la decide el adapter real, D3).
   */
  private aCondiciones(valor: PlantillaDocumentoTenant['condiciones']): CondicionesDocumento {
    const bruto = (valor ?? {}) as Partial<CondicionesDocumento>;
    const tituloVacio = { ca: '', es: '' };
    return {
      titulo: bruto.titulo ?? tituloVacio,
      secciones: Array.isArray(bruto.secciones) ? bruto.secciones : [],
    };
  }
}
