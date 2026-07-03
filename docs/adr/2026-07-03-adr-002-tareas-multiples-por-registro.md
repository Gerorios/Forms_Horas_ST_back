# ADR-002 — Tareas múltiples por registro (M:N, sin horas por tarea)

**Fecha:** 2026-07-03
**Estado:** Aceptado
**Afecta:** el modelo de la tabla de hechos `sth_registros_horas` y la §6.1 del contexto (carga masiva / "Reporte diario").

## Contexto

Hasta ahora cada fila de `sth_registros_horas` tenía **una** tarea (FK directa `tarea_id`).
En la operación real, un operario trabaja **N horas en un contrato** y dentro de esas horas
hace **varias tareas** del maestro, sin poder detallar cuántas horas fue cada una.

> Ej.: hoy un operario hizo **8 hs en el contrato K8**, y dentro de esas 8 hs hizo un **pozo**,
> una **fusión** y una **tapada de pozo**. No se puede (ni tiene sentido) partir las horas por tarea.

## Decisión

Las tareas de un registro pasan a ser una relación **muchos-a-muchos** con el maestro
`sth_tareas_catalogo`, igual que los móviles — **no** una columna/FK directa. Las **horas
quedan a nivel del registro (por contrato)**, no por tarea.

**Modelo de una "línea" de carga:** `{ contrato, horas, tareas[] }` (antes `{ contrato, tarea, horas }`).

**Reglas:**
- **Una línea por contrato** en cada carga: un contrato aparece una sola vez (total de horas de ese contrato + sus tareas).
- **Al menos 1 tarea** por línea (siempre se hizo algo).
- **Tareas por línea** (atadas al contrato de esa línea). **Móviles compartidos** por toda la carga (aplican a todas las filas), como ya era.
- Las tareas siguen saliendo del **maestro** `tareas_catalogo` (estandarizadas), vía `GET /catalogos/tareas?contratoId=`.

**Resultado de una carga:** sigue siendo **N operarios × M líneas** filas en `sth_registros_horas`
(una fila por operario×contrato), pero cada fila ahora tiene `horas` del contrato y un conjunto
de tareas en la tabla puente, más los móviles compartidos.

## Cambios estructurales

**Base de datos (DDL manual — NUNCA `prisma db push`):**
- `DROP FOREIGN KEY sth_registros_horas_tarea_id_fkey` y `DROP COLUMN tarea_id` de `sth_registros_horas`.
- Nueva tabla `sth_registro_tareas (registro_id, tarea_id)`, PK compuesta, FKs a
  `sth_registros_horas(id)` y `sth_tareas_catalogo(id)` (InnoDB; columnas int, sin tema de charset).

**Prisma schema:**
- `RegistroHoras`: quitar `tareaId` y la relación `tarea`; agregar `tareas RegistroTarea[]`.
- Nuevo modelo `RegistroTarea (registroId, tareaId)` mapeado a `sth_registro_tareas`, con relaciones
  a `RegistroHoras` y `TareaCatalogo`. `TareaCatalogo.registros` pasa de `RegistroHoras[]` a `RegistroTarea[]`.

**Backend:**
- DTOs: la línea del batch pasa a `{ contratoId, horas, tareaIds: number[] }` (validar `tareaIds` no vacío
  y `contratoId` único entre líneas). `CreateRegistroHorasDto` (single) y `UpdateRegistroHorasDto` alinean
  al mismo modelo (`tareaIds`).
- `createBatch`: por cada operario×línea crea el registro con `horas`, y linkea las tareas
  (`tareas: { create: tareaIds.map(id => ({ tareaId: id })) }`); valida `contratoId` único y `tareaIds`≥1.
- `INCLUDE_BASICO`: reemplazar `tarea` por `tareas: { include: { tarea: { select: { id, nombre } } } }`.
- `update` (corrección): reemplaza el set de tareas como se hace con móviles (deleteMany + create).

**Frontend:**
- `LineasField`: cada línea = contrato (único, no repetible) + horas + **multiselect de tareas**
  (de `/catalogos/tareas?contratoId`), misma lógica que el multiselect de móviles.
- Reporte: payload `lineas: [{ contratoId, horas, tareaIds }]`. Preview N×M sin cambios (filas = operarios × líneas).
- Tipos: `RegistroHoras.tarea` → `tareas: { tarea: { id, nombre } }[]`. Las tablas (mis registros, aprobaciones)
  muestran las tareas como lista ("pozo, fusión, tapada de pozo").
- Móviles: seedear algunos de ejemplo para que el multiselect (ya compartido) tenga opciones.

## Consecuencias / notas

- **Liquidación externa:** las **horas por contrato** siguen en la fila del registro, así que la
  liquidación por horas no se rompe. La vista SQL (a definir) deberá **agregar/pivotar** las tareas
  desde `sth_registro_tareas` si las necesita.
- **Datos existentes:** los registros de prueba con `tarea_id` se descartan al dropear la columna
  (son datos de prueba, reversibles).
- **Migración de Prisma:** no se usa `prisma migrate`/`db push` (BD compartida). El cambio de schema
  se refleja para el ORM y el DDL se aplica a mano.

## Alternativas consideradas

- **Mantener horas por tarea** (repartir las horas entre tareas): descartado — el operario no puede
  detallar la hora por tarea; sería impreciso e impracticable.
- **Tareas como texto libre**: descartado — se quiere estandarizar contra el maestro (como los móviles).
