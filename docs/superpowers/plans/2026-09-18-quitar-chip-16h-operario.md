# Plan corto: quitar el chip "+16h" de Mis registros (operario)

Fecha: 2026-09-18. Carril corto: 1 archivo de código, sin DDL, sin API.
Frontend, rama `fix/quitar-chip-16h-operario`. Backend solo docs (este plan +
contexto), rama `docs/quitar-chip-16h`.

**Qué se pide.** Los operarios se confunden con la marca `+16h` que aparece
junto a las horas de un día en "Mis registros". Quitarla de esa vista. La
alerta de ≥16 hs sigue existiendo para los jefes (aprobaciones, control
general, `lote-card`, `lote-resumen-card`): ahí no se toca.

**Archivo.** `src/features/mis-registros/registros-cards.tsx`: sacar el
`<span>+16h</span>` condicionado por `alertaHoras` en `TarjetaSimple` y en
`TarjetaCorregida`. El campo `alertaHoras` sigue viniendo del backend; solo
deja de dibujarse acá.

**Test rojo primero.** En `registros-cards.test.tsx`: un registro con
`alertaHoras: true` no debe mostrar `+16h` (ni en tarjeta simple ni en la
corregida). Hoy falla porque el chip se dibuja.

**Verificación.** `vitest run registros-cards.test.tsx` → verde; `tsc`;
`eslint` del archivo; suite completa una vez; `code-review` (1 agente, 2
ejes) → `verificador-review`; 1 ronda.

**Riesgo.** Ninguno de datos. Visual: el operario deja de ver la advertencia
de jornada larga; la sigue viendo su jefe al aprobar, que es quien actúa.
