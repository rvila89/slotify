/** Declara los roles permitidos para un endpoint (consumido por `RolesGuard`). */
import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
