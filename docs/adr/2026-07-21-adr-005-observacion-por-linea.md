# ADR-005 — Observación de texto libre, una por línea de carga

**Fecha:** 2026-07-21
**Estado:** Aceptado
**Afecta:** `sth_registros_horas` (nueva columna), `POST /registros-horas` y
`POST /registros-horas/batch`, `PATCH /registros-horas/:id`, el formulario de
reporte y el detalle por contrato de `/aprobaciones` y "Cargas que hice".

## Contexto

El Jefe de Contrato aprueba o desaprueba horas viendo solo `{operario, contrato,
horas, tareas}`. No hay forma de que quien carga explique el contexto: cuántas
tareas se ejecutaron realmente, si la cuadrilla tuvo que viajar a otra
localidad ese día, u otra justificación de por qué esa cantidad de horas tiene
sentido para esas tareas. Sin eso, el Jefe de Contrato aprueba a ciegas.

## Decisión

Se agrega `observacion` (texto libre, opcional) a `sth_registros_horas`. Sigue
el mismo criterio que `horas` y `tareas` (ADR-002): es un dato **de la línea de
carga**, no del operario — un solo texto por línea, compartido por todos los
operarios de esa carga en ese contrato. Se muestra en el detalle por contrato
de `/aprobaciones` (ADR-004) y de "Cargas que hice", junto al subtotal de horas
y las tareas.

## Alternativas consideradas

- **Observación por operario (una por fila).** Permitiría distinguir, por
  ejemplo, que solo uno de cinco operarios viajó. Se descartó por ahora: la
  productividad y el contexto que se busca registrar (tareas ejecutadas,
  viajes) son atributos del trabajo de la cuadrilla en ese contrato ese día,
  no de cada individuo — igual que las horas. Si aparece un caso real que lo
  necesite, se puede sumar sin romper esto (agregar un campo por-fila además
  del compartido).

## Consecuencias / notas

- **Alcance explícitamente diferido:** listado de materiales utilizados y
  tickets de combustible cargados. Quedan fuera de esta decisión — serán su
  propio apartado a futuro, no se modela nada para ellos acá.
- **Migración de Prisma:** igual que ADR-002/003/004, la BD es compartida — el
  DDL (`ALTER TABLE ... ADD COLUMN observacion TEXT NULL`) se aplica a mano,
  nunca `prisma migrate`/`db push`.
- Al ser una única fila por (lote, contrato) la que "manda" el valor (las demás
  filas de operarios de esa misma línea la repiten, igual que `horas`), el
  agrupado por contrato en el frontend toma el valor de una fila representante
  del grupo, no lo concatena ni lo suma.
