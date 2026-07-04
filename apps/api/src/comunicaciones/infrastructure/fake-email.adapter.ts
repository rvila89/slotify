/**
 * Adaptador FAKE del puerto `EnviarEmailPort` (US-045, design.md §1/§6).
 *
 * Transporte en MEMORIA, sin red: registra los envíos para las aserciones de tests
 * y de QA, y puede simular un fallo del proveedor (`forzarFallo`). Es el adaptador
 * que se selecciona con `EMAIL_TRANSPORT=fake` (forzado en `test`/CI), de modo que
 * `pnpm test` y los curl/E2E nunca envían correos reales a clientes.
 *
 * Es INFRAESTRUCTURA: implementa el puerto de dominio sin que este conozca el modo
 * fake. No introduce locks ni estado distribuido (solo un array en memoria).
 */
import { Injectable } from '@nestjs/common';
import type {
  EnviarEmailComando,
  EnviarEmailPort,
} from '../domain/enviar-email.port';

@Injectable()
export class FakeEmailAdapter implements EnviarEmailPort {
  private readonly registro: EnviarEmailComando[] = [];
  private fallo: Error | null = null;

  /** Envíos acumulados en orden (solo lectura) para las aserciones. */
  get enviados(): ReadonlyArray<EnviarEmailComando> {
    return this.registro;
  }

  /** Programa un fallo del proveedor para el siguiente envío (tests del motor). */
  forzarFallo(error: Error): void {
    this.fallo = error;
  }

  async enviar(comando: EnviarEmailComando): Promise<void> {
    if (this.fallo !== null) {
      // One-shot: falla SOLO el siguiente envío y se rearma (permite probar el
      // reintento con éxito tras un fallo previo dentro del mismo módulo/singleton).
      const error = this.fallo;
      this.fallo = null;
      throw error;
    }
    // Cero red: solo se acumula en memoria.
    this.registro.push(comando);
    return Promise.resolve();
  }
}
