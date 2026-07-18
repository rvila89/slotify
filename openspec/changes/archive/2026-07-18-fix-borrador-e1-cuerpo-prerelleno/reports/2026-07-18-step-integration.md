# Step 7 — Test de integración (adapter SQL real)

**Fecha:** 2026-07-18
**Change:** fix-borrador-e1-cuerpo-prerelleno
**BD:** `slotify_test` (Postgres real, migraciones al día tras resolver drift de
`20260717150000_add_idioma_horario_to_reserva`)

---

## Comando
```
npx jest comunicacion-actualizar-contenido-borrador.integration
```

## Resultado

✅ 1 suite, **3 tests passed** contra Postgres real:

1. **Relleno del borrador** — `actualizarContenidoBorrador` sobre una fila `borrador`
   cambia `asunto` + `cuerpo` y **conserva** `estado='borrador'` y `fecha_envio=null`
   (verificado releyendo la fila con `prisma.comunicacion.findUnique`).
2. **Guarda de estado** — sobre una fila `estado='enviado'` **no muta** asunto/cuerpo
   (el `where estado='borrador'` del `updateMany` la excluye).
3. **Aislamiento cross-tenant** — un tenant distinto no muta la fila (filtro `tenant_id`
   en UPDATE y relectura → rechaza sin efectos).

**Por qué es obligatorio (no basta con dobles):** la guarda de estado y el aislamiento por
tenant son comportamiento del motor de PostgreSQL, no del use-case (memoria: "US-049
backend nunca probado contra BD real").

**Veredicto:** PASS.
