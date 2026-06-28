/**
 * Puerto de DOMINIO `CatalogoPlantillasPort` (US-045 / UC-35, design.md §3).
 *
 * Interfaz PURA (sin `@nestjs/*`, Prisma ni infraestructura): describe la selección
 * de plantilla por `codigoEmail` + idioma y el contrato de una `Plantilla`
 * (metadatos + función de render tipada). La infraestructura aporta el catálogo
 * concreto (`CatalogoPlantillasEnCodigo`). El motor depende SOLO de este puerto.
 */
import type { CodigoEmail } from './codigo-email';

/** Resultado del render de una plantilla con sus variables sustituidas. */
export interface RenderPlantilla {
  /** Asunto del email ya interpolado. */
  asunto: string;
  /** Cuerpo HTML del email ya interpolado. */
  cuerpoHtml: string;
  /** Cuerpo en texto plano (fallback / clientes sin HTML). */
  cuerpoTexto: string;
}

/** Plantilla declarada en el catálogo, indexada por `codigoEmail` + idioma. */
export interface Plantilla {
  /** Código del email al que sirve la plantilla. */
  codigoEmail: CodigoEmail;
  /** Idioma de la plantilla (p. ej. `es`). */
  idioma: string;
  /** `true` si la plantilla está activa (E1); `false` si está diseñada/inactiva. */
  activa: boolean;
  /** Variables que el render REQUIERE no nulas para poder enviar. */
  variablesRequeridas: string[];
  /** Claves de adjuntos que la plantilla REQUIERE disponibles para enviar. */
  adjuntosRequeridos: string[];
  /** Render tipado: produce asunto + cuerpos a partir de las variables. */
  render(variables: Record<string, unknown>): RenderPlantilla;
}

/** Puerto de selección de plantillas del catálogo. */
export interface CatalogoPlantillasPort {
  /** Selecciona la plantilla del `codigoEmail` en `idioma`, o `null` si no existe. */
  seleccionar(codigoEmail: CodigoEmail, idioma: string): Plantilla | null;
}
