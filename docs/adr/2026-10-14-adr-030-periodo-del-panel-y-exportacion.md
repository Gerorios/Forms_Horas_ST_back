# ADR-030 — Período libre en Control general y Excel del Detalle diario

**Fecha:** 2026-10-14
**Estado:** Aceptado
**Afecta:** `src/registros-horas/` (`periodo-panel.ts`, `export-detalle.service.ts`,
endpoints del panel con `PanelQueryDto`). Frontend: barra de filtros y Detalle
diario de Control general. Sin DDL.

## Contexto

Los jefes de contrato pidieron más filtros en Control general y poder exportar
a Excel lo filtrado del Detalle diario, con los móviles y las observaciones. Hasta
hoy el panel consultaba **siempre una quincena** (año, mes, quincena obligatorios)
y filtraba por contrato, provincia y operario.

## Decisión

1. **Período del panel**: una quincena, un **mes completo** (año + mes sin
   quincena) o un **rango desde/hasta** (manda sobre el mes, tope de 12 meses).
   Un rango que coincide exacto con una quincena se trata como esa quincena.
   Lo valida `resolverPeriodo`; combinaciones inválidas → 400.
2. **Lo que es por quincena solo se calcula con quincena**: el umbral de horas
   extra (88 hs, ADR-009) y la comparación con la quincena anterior. Con un mes
   o un rango, `superaHorasExtra` es `false` y la anterior es `null`. "Sin carga"
   sigue pidiendo una quincena. El histórico termina en la quincena del último
   día del período.
3. **Filtro de tarea** (`tareaIds`): un registro pasa si tiene alguna de las
   tareas elegidas. En pantalla sigue la regla de siempre: los filtros deciden
   **qué personas entran**, nunca recortan sus horas (glosario, "Operario del jefe").
4. **Excel del Detalle diario** (`GET /registros-horas/detalle-diario/excel`):
   a diferencia de la pantalla, exporta **solo las filas que cumplen los
   filtros y caen en mis contratos** — nada de contratos ajenos. Una fila por
   registro, con las tareas juntas (las horas no se duplican), móviles,
   observación y auditoría (cargó/aprobó y cuándo, en hora argentina).

## Alternativas descartadas

- **Excel igual a la pantalla** (jornada completa con contratos ajenos): mezcla
  trabajo de otros jefes en un archivo que se usa para controlar tareas propias.
- **Una fila por tarea**: cómodo para tablas dinámicas, pero repite las horas
  del registro en cada fila y sumar da de más.
- **Recalcular +88hs para un rango**: el umbral es por quincena; prorratearlo a
  un rango arbitrario inventa una regla que no existe.

## Consecuencias

- Los endpoints del panel aceptan `anio`/`mes`/`quincena` opcionales o
  `desde`/`hasta`; un cliente viejo que manda los tres sigue funcionando igual.
- `horasAprobadasAnterior` y `deltaHorasAprobadas` pueden venir `null`.
- El rango de 12 meses trae todas las filas del período al Detalle diario; con
  el volumen actual de la base no pesa, pero es el tope a revisar si crece.
