/** Forma del usuario autenticado derivada del payload del JWT de acceso. */
export interface UsuarioAutenticado {
  /** Identificador del usuario (sub del JWT). */
  sub: string;
  /** Tenant al que pertenece el usuario (deriva del JWT, nunca del path/body). */
  tenantId: string;
  /** Rol del usuario (en el MVP, siempre `gestor`). */
  rol: string;
  email?: string;
}
