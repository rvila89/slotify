/**
 * TEST DE ADAPTER del `PasswordHasherPort` con argon2 (US-001) — fase TDD RED.
 *
 * Trazabilidad: tasks.md Fase 3: 3.6 ("`argon2-password-hasher` verifica el hash
 * del seed"). Apoya REQ 1 (verificación de credenciales contra el hash argon2).
 *
 * Es un test de INFRAESTRUCTURA (no de dominio): usa la librería `argon2` REAL
 * —la misma que `prisma/seed.ts` usa para hashear `Slotify2026!`— para comprobar
 * que el adapter verifica correctamente un hash argon2 verdadero, sin tocar BD.
 *
 * RED: aún no existe `auth/infrastructure/argon2-password-hasher.adapter.ts` →
 * ROJO por símbolo de producción ausente (no por configuración del runner).
 */
import * as argon2 from 'argon2';
import { Argon2PasswordHasher } from '../infrastructure/argon2-password-hasher.adapter';

const PASSWORD = 'Slotify2026!';

describe('Argon2PasswordHasher — verificación del hash del seed (3.6)', () => {
  it('debe_verificar_true_cuando_la_password_coincide_con_un_hash_argon2_real', async () => {
    const hash = await argon2.hash(PASSWORD);
    const hasher = new Argon2PasswordHasher();

    await expect(hasher.verificar(PASSWORD, hash)).resolves.toBe(true);
  });

  it('debe_verificar_false_cuando_la_password_no_coincide', async () => {
    const hash = await argon2.hash(PASSWORD);
    const hasher = new Argon2PasswordHasher();

    await expect(hasher.verificar('contraseña-incorrecta', hash)).resolves.toBe(false);
  });
});
