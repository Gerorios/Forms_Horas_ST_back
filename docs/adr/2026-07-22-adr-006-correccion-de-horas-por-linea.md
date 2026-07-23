# ADR-006 — Corrección de horas por línea (fila nueva, no edición in place)

**Fecha:** 2026-07-22
**Estado:** Aceptado
**Afecta:** `sth_registros_horas` (nueva columna `loteIdOrigen`), nuevo endpoint
`PATCH /registros-horas/lote/:loteId/corregir`, y el detalle por contrato de
`/aprobaciones`.

## Contexto

Hoy el Jefe de Contrato solo puede aprobar o desaprobar una línea tal cual fue
declarada. Si audita el GPS de la carga y ve que las horas declaradas no son
reales (ej. declararon 12hs y el recorrido muestra 8), su única opción es
desaprobar con un motivo y esperar que alguien vuelva a cargar el valor
correcto — un paso extra evitable, ya que el propio Jefe de Contrato ya sabe
cuál es el valor real.

El endpoint genérico de corrección (`PATCH /registros-horas/:id`, pensado para
que quien cargó edite su propia fila desaprobada) existe pero nunca tuvo UI, y
edita la fila **in place** — perdería el rastro de que alguna vez fueron 12hs
si se usara para este caso.

## Decisión

Se agrega una corrección **a nivel línea** (contrato dentro de un lote, no por
operario — el GPS que se audita es el de la carga, no de cada persona; ver
glosario "Línea de carga"). El Jefe de Contrato corrige la hora total
declarada para esa línea con un motivo, y el sistema:

1. Marca **todas** las filas de esa línea (un operario por fila, mismo
   criterio que ADR-002) como `desaprobado`, con el motivo.
2. Crea filas **nuevas** para esos mismos operarios: mismo contrato, tareas,
   observación y móviles copiados; la hora corregida; estado `aprobado`
   directo (el propio Jefe de Contrato es quien decide el valor, no hace
   falta que se apruebe a sí mismo después); `aprobadoPorCuil`/`aprobadoEn`
   seteados a ese momento.
3. Las filas nuevas llevan `loteIdOrigen` apuntando al `loteId` que quedó
   rechazado — vínculo explícito de trazabilidad.

Solo aplica sobre líneas en estado `pendiente` (si ya estaba resuelta, primero
se reabre con lo que ya existe, y después se corrige).

## Alternativas consideradas

- **Editar la fila in place** (lo que ya hace `PATCH /registros-horas/:id`).
  Requeriría además construir una pantalla que lea la tabla `Auditoria` (hoy
  se escribe pero nunca se lee) para que el operario vea "esto fue 12hs, se
  corrigió a 8". Se descartó: la fila nueva logra lo mismo reutilizando lo que
  ya existe (el operario ve ambas cargas en su propia quincena, con el motivo
  de rechazo ya visible) sin levantar esa capacidad sin usar.
- **Sin vínculo explícito** (`loteIdOrigen`), confiando en que fecha + motivo
  alcancen para que se entienda la relación a simple vista. Se descartó
  porque el rol "Liquidador" (ver "Ideas a futuro" en el glosario) previsiblemente
  va a necesitar recorrer esta relación de forma mecánica, no interpretando
  texto libre.
- **Corrección por operario individual.** Se descartó porque no hay tracking
  de GPS por persona en el sistema (el GPS es uno por carga, ver
  `RegistroHoras.gpsLat/gpsLng`) — la auditoría que motiva la corrección es
  inherentemente de la línea completa.

## Consecuencias / notas

- **Migración de Prisma:** igual que ADR-002/003/004/005, la BD es
  compartida — el DDL se aplica a mano, nunca `prisma migrate`/`db push`.
- La alerta de >16hs/día se recalcula para las filas nuevas excluyendo lo
  desaprobado (mismo criterio que `create()`/`createBatch()`), así que la fila
  recién rechazada no infla la alerta de la corrección.
- Esto no reemplaza el `PATCH /registros-horas/:id` general — sigue existiendo
  para que quien cargó corrija su propia fila desaprobada más tarde, sin
  necesidad de auditoría GPS de por medio.
