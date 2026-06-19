---
name: tanstack-forms
description: Usar cuando haya que construir formularios con React Hook Form + Zod y escribir datos con TanStack Query useMutation.
---

# Formularios: RHF + Zod + TanStack Query

## Cuándo usar
- Al crear formularios de creación/edición en el frontend.
- Para validar entradas y mapear errores del backend a mensajes de formulario.

## Reglas
- Validación con **Zod**; integración con **React Hook Form** (`zodResolver`).
- Escritura con **TanStack Query `useMutation`**; invalidar queries afectadas en `onSuccess`.
- **Errores del backend** mapeados a mensajes de formulario **en español**:
  - **400** validación → mapear a campo concreto vía `setError`.
  - **409** conflicto (fecha bloqueada) → error global del form ("La fecha ya está bloqueada").
  - **422** transición inválida → error global ("Transición de estado no permitida").
- No inventar tipos: reusar esquemas/tipos del cliente generado (o Zod de orval).

## Patrón de referencia
```tsx
const form = useForm({ resolver: zodResolver(reservaSchema) });

const mutation = useMutation({
  mutationFn: (data) => apiClient.crearReserva(data),
  onSuccess: () => qc.invalidateQueries({ queryKey: ['reservas'] }),
  onError: (e) => {
    if (e.statusCode === 400) form.setError(e.field, { message: e.message });
    else if (e.statusCode === 409) form.setError('root', { message: 'La fecha ya está bloqueada' });
    else if (e.statusCode === 422) form.setError('root', { message: 'Transición de estado no permitida' });
  },
});

const onSubmit = form.handleSubmit((d) => mutation.mutate(d));
```

## Errores comunes
- Mostrar el error crudo de NestJS al usuario en vez de un mensaje en español.
- No distinguir 400 (campo) de 409/422 (global).
- Olvidar `invalidateQueries` tras mutar.
- Validar solo en cliente y confiar en ello (el backend manda).

## Fuentes
- `docs/frontend-standards.md`. Error NestJS: `{ statusCode, message, error }`.
- Skills: `frontend-feature`, `shadcn-tailwind`, `contract-sync`.
