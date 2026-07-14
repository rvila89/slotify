/**
 * Reglas de arquitectura hexagonal (Regla 6).
 *
 * El dominio (`src/** /domain/**`) es el núcleo puro: NO puede importar
 * infraestructura, Prisma, NestJS ni librerías de terceros.
 * Solo se permiten imports relativos dentro del propio dominio
 * (entidades, value objects, eventos y puertos) y tipos puros.
 */
module.exports = {
  forbidden: [
    {
      name: 'dominio-no-importa-infra-ni-frameworks',
      comment:
        'Un módulo de dominio (domain/**) no puede importar infrastructure, prisma, @nestjs ' +
        'ni librerías de terceros. El dominio debe permanecer puro (hexagonal). ' +
        'Solo se permiten imports relativos dentro de domain.',
      severity: 'error',
      from: {
        path: 'src/[^/]+/domain/',
      },
      to: {
        pathNot: [
          // Permitido: imports relativos que permanezcan dentro de algún domain/
          'src/[^/]+/domain/',
        ],
        path: [
          // Prohibido: cualquier ruta que apunte a infraestructura
          'infrastructure',
          // Prohibido: Prisma (cliente o paquete)
          'prisma',
          '[@]prisma',
          // Prohibido: cualquier paquete de NestJS
          '[@]nestjs',
          // Prohibido: cualquier dependencia de terceros (node_modules)
          'node_modules',
        ],
      },
    },
    {
      name: 'no-circular',
      comment: 'No se permiten dependencias circulares.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    // No seguimos hacia dentro de node_modules (no analizamos sus ficheros),
    // pero SÍ registramos la dependencia hacia ellos para poder prohibirla.
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.json'],
    },
  },
};
