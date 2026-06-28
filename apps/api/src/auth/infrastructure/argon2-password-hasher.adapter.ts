/**
 * Adaptador del `PasswordHasherPort` con argon2 (US-001).
 *
 * Verifica la contraseña en claro contra el hash argon2 almacenado (el mismo
 * algoritmo con que `prisma/seed.ts` hashea `Slotify2026!`). La contraseña en claro
 * jamás se persiste ni se loguea; solo se usa para la verificación criptográfica.
 */
import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import type { PasswordHasherPort } from '../application/login.use-case';

@Injectable()
export class Argon2PasswordHasher implements PasswordHasherPort {
  async verificar(password: string, hash: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      // Hash malformado o algoritmo no soportado → tratamos como no coincidente,
      // nunca como 500 (evita filtrar detalles del almacén de credenciales).
      return false;
    }
  }
}
