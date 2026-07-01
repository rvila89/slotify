/**
 * TESTS del `ConsultarCalendarioQueryDto` (US-039 / UC-29) a nivel de VALIDACIÓN de
 * forma, ejercitando `class-validator` directamente (`plainToInstance` + `validate`),
 * sin levantar Nest. Es el nivel natural para la regla CROSS-FIELD del rango.
 *
 * HALLAZGO H-1: el rango INVERTIDO (`desde > hasta`) hoy pasa la validación (cada campo
 * cumple su `@Matches(YYYY-MM-DD)` por separado), porque NO hay una regla que relacione
 * ambos campos. Debe existir un validador cross-field que falle cuando `desde > hasta`
 * con un mensaje claro en español (`desde` <= `hasta`).
 *
 * El `ValidationPipe` GLOBAL (`main.ts`) traduce este fallo de class-validator a 400
 * (ver `consultar-calendario.controller.http.spec.ts`), código que el contrato OpenAPI
 * declara para `/calendario` (NO 422).
 *
 * RED: la regla cross-field aún no existe en el DTO, así que un rango invertido valida
 * sin errores. GREEN (añadir el validador) es de `backend-developer`.
 */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConsultarCalendarioQueryDto } from '../consultar-calendario.dto';

const MENSAJE_RANGO = 'El parámetro «desde» debe ser anterior o igual a «hasta»';

const validarQuery = (raw: Record<string, unknown>) => {
  const dto = plainToInstance(ConsultarCalendarioQueryDto, raw);
  return validate(dto);
};

describe('ConsultarCalendarioQueryDto — regla cross-field desde <= hasta (US-039, H-1)', () => {
  it('debe_fallar_la_validacion_cuando_desde_es_posterior_a_hasta', async () => {
    const errores = await validarQuery({ desde: '2026-08-31', hasta: '2026-08-01' });

    // El rango invertido debe producir AL MENOS un error de validación.
    expect(errores.length).toBeGreaterThan(0);
    // Con un mensaje claro en español sobre el orden del rango.
    const mensajes = errores
      .flatMap((e) => Object.values(e.constraints ?? {}))
      .join(' ');
    expect(mensajes).toContain(MENSAJE_RANGO);
  });

  it('debe_validar_sin_errores_cuando_desde_es_igual_a_hasta_mismo_dia', async () => {
    const errores = await validarQuery({ desde: '2026-08-15', hasta: '2026-08-15' });

    // Caso de control: un único día (límite inclusivo) es un rango válido.
    expect(errores).toHaveLength(0);
  });

  it('debe_validar_sin_errores_cuando_desde_es_anterior_a_hasta', async () => {
    const errores = await validarQuery({ desde: '2026-08-01', hasta: '2026-08-31' });

    // Caso de control: el rango normal sigue siendo válido al añadir la guarda.
    expect(errores).toHaveLength(0);
  });
});
