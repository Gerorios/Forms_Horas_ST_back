# ADR-004 — Aprobación por carga (`loteId`), no por fila individual

**Fecha:** 2026-07-16
**Estado:** Aceptado
**Afecta:** `sth_registros_horas` (nueva columna), el endpoint de aprobación
(`registros-horas.service.ts`), y `/aprobaciones` en el frontend. Extiende el modelo de carga
masiva definido en ADR-002.

## Contexto

ADR-002 definió que una carga masiva genera **N operarios × M líneas = N×M filas** en
`sth_registros_horas`, cada una independiente. Ese modelo nunca guardó **qué filas vinieron del
mismo envío** — no hay ninguna columna que las relacione entre sí.

En la práctica, un Jefe de Cuadrilla carga de una sola vez el trabajo de varios operarios en
varios contratos (ej. 5 operarios en 3 contratos = 15 filas). Hoy, el Jefe de Contrato que aprueba
ve esas filas agrupadas visualmente por (operario, fecha) en `/aprobaciones`, pero **cada fila se
aprueba o desaprueba una por una** — para una carga de 5 operarios en su contrato, son 5 clics
separados. El jefe pidió simplificar esto: una sola acción por carga, no una por persona.

## Decisión

Se agrega `loteId` (string, UUID) a `sth_registros_horas`, generado **una vez por envío** (tanto
en `POST /registros-horas` individual como en `POST /registros-horas/batch`) y compartido por
todas las filas que ese envío produce. Toda fila tiene un `loteId` — no es opcional; una carga
individual es, simplemente, un lote de una sola fila.

`/aprobaciones` pasa a agrupar por `loteId` en vez de por (operarioCuil, fecha). El Jefe de
Contrato aprueba o desaprueba **todas las filas de su contrato dentro de un lote con una sola
acción**, con la opción de destildar excepciones puntuales antes de confirmar (esas filas quedan
`pendiente`, se resuelven aparte). Las filas de otros contratos dentro del mismo lote se siguen
mostrando como contexto (no accionables), igual que antes — el cambio es la granularidad de la
acción, no la información mostrada.

## Alternativas consideradas

- **Agrupar por (cargadoPorCuil, fecha, contratoId), sin columna nueva.** Más rápido de
  implementar, cero cambios de schema. Se descartó: si el mismo Jefe de Cuadrilla carga dos envíos
  distintos el mismo día para el mismo contrato (ej. turno mañana y turno tarde), esta heurística
  los mezclaría en una sola aprobación aunque el jefe quisiera tratarlos por separado. Un `loteId`
  explícito no tiene ese problema — identifica el envío real, no una coincidencia de fecha/contrato.

## Consecuencias / notas

- **Backfill:** las filas `pendiente` que ya existen en la base (datos de prueba del usuario, sin
  `loteId`) necesitan un valor al agregar la columna. Al ser datos de prueba, cada fila existente
  recibe un `loteId` propio (lote de 1) — no se intenta reconstruir qué filas vinieron del mismo
  envío original.
- **Migración de Prisma:** igual que en ADR-002/ADR-003, la BD es compartida — el DDL se aplica a
  mano, nunca `prisma migrate`/`db push`.
- **No cambia el modelo de datos de ADR-002** (sigue siendo N×M filas independientes) — solo agrega
  el dato de agrupación que faltaba. `operarioCuil`/`cargadoPorCuil`/`contratoId` por fila no
  cambian de significado.
