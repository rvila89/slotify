/**
 * TEST de configuración de rate-limiting de `/auth/login` (US-001) — fase TDD RED.
 *
 * Trazabilidad: US-001, decisión §3-A (brute-force con `@nestjs/throttler` por
 * IP+email → 429). REQ 8.
 *
 * El 429 efectivo lo impone el `ThrottlerGuard` del framework y se verifica
 * end-to-end en QA (tasks 6.7 curl). Aquí, en RED, se PINNEA que existe una
 * configuración de throttling del login (límite finito + ventana) y un generador
 * de clave que combina IP + email, como contrato de la implementación.
 *
 * RED: aún no existe `auth/auth.throttle.ts` → ROJO por símbolo de producción
 * ausente. NOTA: el nombre exacto del símbolo es una asunción documentada; el
 * backend-developer puede ajustarlo y este test es su especificación.
 */
import { LOGIN_THROTTLE, claveThrottleLogin } from '../auth.throttle';

describe('Rate-limiting de /auth/login (REQ 8)', () => {
  it('debe_definir_un_limite_finito_de_intentos_y_una_ventana_de_tiempo', () => {
    expect(Number.isFinite(LOGIN_THROTTLE.limit)).toBe(true);
    expect(LOGIN_THROTTLE.limit).toBeGreaterThan(0);
    expect(LOGIN_THROTTLE.ttl).toBeGreaterThan(0);
  });

  it('debe_generar_una_clave_de_throttling_que_combina_IP_y_email', () => {
    const clave = claveThrottleLogin('203.0.113.7', 'info@masialencis.com');

    expect(clave).toContain('203.0.113.7');
    expect(clave).toContain('info@masialencis.com');
  });

  it('debe_distinguir_la_clave_por_email_para_la_misma_IP', () => {
    const claveA = claveThrottleLogin('203.0.113.7', 'a@masialencis.com');
    const claveB = claveThrottleLogin('203.0.113.7', 'b@masialencis.com');

    expect(claveA).not.toBe(claveB);
  });
});
