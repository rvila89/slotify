---
name: tdd-core
description: Usar cuando se implemente lógica de dominio o casos de uso y haya que seguir el ciclo TDD RED→GREEN→REFACTOR antes de escribir código de producción.
---
# TDD del núcleo crítico

## Cuándo usar
- Al implementar cualquier lógica del núcleo: bloqueo de fecha, máquina de estados, motor de tarifas/IVA/señal/liquidación, casos de uso de `reservas`.
- Cuando el hook `require-tests-first` bloquea editar código de producción sin un test correspondiente.
- Antes de escribir CRUD, controladores o UI.

## Reglas / Pasos
1. **RED**: escribe primero un test que FALLE. Ejecútalo (`pnpm test`) y verifica el rojo real (no un error de compilación trivial).
2. **GREEN**: implementa el mínimo código de producción para que pase. Nada más.
3. **REFACTOR**: limpia con los tests en verde como red de seguridad.
4. Respeta el **orden TDD impuesto por la arquitectura**:
   1. Concurrencia del bloqueo atómico de fecha (PRIMERO).
   2. Máquina de estados (cada transición permitida/prohibida + guardas).
   3. Motor de tarifas e IVA/señal/liquidación.
   4. CRUD/controladores/integración.
5. El `tdd-engineer` escribe **SOLO tests**, nunca código de producción.
6. Dominio aislado: testa casos de uso con **dobles de los puertos** (mocks de repos), sin tocar Prisma.
7. Patrón **AAA** (Arrange-Act-Assert). Framework: **Jest** (unit) + **Supertest** (e2e). No se usa Vitest en backend.
8. Nombres en español orientados a comportamiento: `debe_rechazar_segunda_reserva_cuando_fecha_ya_bloqueada`.
9. Cobertura alta en el módulo `reservas`.

## Patrón de referencia
```ts
describe('CrearReserva', () => {
  it('debe_rechazar_segunda_reserva_cuando_fecha_ya_bloqueada', async () => {
    // Arrange
    const repo = mockReservaRepo();
    repo.bloquearFecha.mockRejectedValueOnce(new ConflictoFechaError());
    const useCase = new CrearReserva(repo);
    // Act / Assert
    await expect(useCase.execute(dto)).rejects.toThrow(ConflictoFechaError);
  });
});
```
Comandos: `pnpm test`, `pnpm test:watch`, `pnpm test:cov`, `pnpm test:e2e`.

## Errores comunes
- Escribir el código de producción antes que el test (el hook lo bloquea).
- Saltarse la verificación del rojo: un test que nunca falló no prueba nada.
- Importar Prisma en tests de dominio en vez de usar dobles de puertos.
- Romper el orden TDD (p. ej. testar CRUD antes que la concurrencia).
- Nombres en inglés o genéricos (`test should work`).

## Fuentes
- `docs/backend-standards.md`
- `CLAUDE.md` (sección Testing y Máquina de estados)
