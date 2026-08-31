# ADR-021: Cierre de liquidación quincenal versionado (snapshot, sin bloqueo) + export Excel + bono quincenal

## Contexto

El módulo de Liquidación calcula todo **en vivo** (`/liquidacion/quincena/detalle`
recalcula en cada visita, nada se persiste). El entregable real del proceso —
el archivo Excel que el encargado de la preliquidación le envía cada quincena
al **liquidador de sueldos** (externo, carga los recibos en el sistema de
sueldos real) — todavía se fabricaba a mano por el método viejo
(AppSheet → Power BI → pegar en Excel → fórmulas). Todo el cálculo ya lo
absorbió la app; faltaba el último eslabón: registrar qué se envió y generar
el archivo. La necesidad quedó parqueada el 2026-08-14 y se retomó el
2026-08-30 con una sesión de grilling (archivo real de referencia:
`Copia de 2026_08_1q_Sueldo SERTEC.xlsx`, 1ª quincena de agosto).

## Decisión

### 1. Cierre = snapshot versionado, nunca un candado

- **Cerrar** una quincena congela el resultado del motor de cálculo en tablas
  de hechos propias. Los datos de origen (horas, novedades, precios, plus)
  **siguen editables** — coherente con la filosofía del sistema (ediciones
  retroactivas auditadas, no inmutabilidad; ver amendment de ADR-010).
- **Versionado real**: recerrar crea una versión nueva (v1, v2, …); las
  anteriores no se tocan jamás. "La vigente" = la de `version` más alta
  (derivada — sin flag que pueda quedar desincronizado). La nota que explica
  el motivo es **obligatoria en recierres**, inexistente en la v1.
- **Avisa, no bloquea**: el cierre muestra las salvedades (pendientes de
  aprobar, sin perfil, precios sin resolver, sin km, sin zona) y exige
  confirmación; las salvedades quedan **grabadas en el cierre**. Se descartó
  el bloqueo duro: dejaría el envío rehén del dato faltante más chico, y el
  liquidador de sueldos tiene fecha límite.

### 2. Tablas de hechos 100% desnormalizadas

- `sth_cierres_liquidacion` (cabecera: período + versión + quién/cuándo/nota/
  salvedades), `sth_cierre_liquidacion_detalle` (una fila por empleado, todos
  los valores **congelados como número/texto**, sin FK navegable a datos
  vivos) y `sth_cierre_dias_trabajados` (los días trabajados del período,
  congelados — alimentan la hoja de feriados del Excel).
- El `cuil` del detalle es identificador congelado, no relación Prisma: si el
  ERP borra al empleado, la foto queda intacta.
- La zona (ver abajo) también se congela por fila: una mudanza posterior no
  reescribe la historia.

### 3. El Excel sale ÚNICAMENTE de un cierre

Nunca del cálculo en vivo — así "el archivo que viajó" y "lo que quedó
registrado" son siempre la misma cosa. Se descartó el export "borrador":
la revisión previa la resuelve el panel en pantalla, y recerrar es barato.
Hojas replicadas del archivo real: TOTAL + NORTE + TUCUMAN + resumen de
totales + DIAS TRABAJADOS (transitoria, hasta automatizar feriados). El
export de los "por tantos en B" es un **archivo aparte**, del mismo cierre.

### 4. Zona NORTE/SUR derivada de la provincia del ERP

`snuempleados.provincia`: **NORTE = SALTA + JUJUY, SUR = TUCUMAN** (la hoja
del archivo se llama "TUCUMAN"). Mantener ese campo al día es responsabilidad
de la empresa en el ERP. Provincia vacía/no mapeada = "sin zona": alerta y
salvedad, sale en la hoja TOTAL pero en ninguna hoja de zona — nunca cae en
una zona por default. Se descartó un campo `zona` propio en
`PerfilLiquidacion` (decisión explícita del dueño de producto).

### 5. Consumo del analista: lectura directa de MySQL

Usuario MySQL de **solo lectura** limitado a las tablas de hechos (coordinar
con IT) — el formato desnormalizado y congelado es exactamente lo que una
herramienta de BI necesita. Se descartó una API REST para esto (el JWT de 1h
es incómodo para BI; se agregaría solo si un sistema aplicativo la pidiera).

### 6. Bono no remunerativo pasa de mensual a QUINCENAL (amienda ADR-011/018)

UOCRA puede anunciar un bono para una quincena puntual. El bono se resuelve
por **(categoría, año, mes, quincena)** manteniendo las reglas de ADR-018
(campo opcional, "sin bono" = fila explícita $0, sin fila = "sin resolver").
**Backfill**: cada fila mensual existente se duplica en las dos quincenas —
fiel a lo que el motor efectivamente pagaba (el bono mensual se aplicaba
completo en cada quincena), y deja una sola lógica en el código. En la UI, la
tarjeta Bono adopta el patrón de Plus individual: selector de quincena +
precio por categoría (decisión explícita: sin dobles columnas 1Q/2Q).

## Consecuencias

- DDL a mano en LAS DOS bases (`testing` primero, `Horas_Sertec` al deploy),
  nunca `prisma migrate` (BD compartida).
- El detalle del cierre duplica datos a propósito (denormalización): el costo
  en espacio (~130 filas por cierre) es el precio de la reproducibilidad.
- La hoja DIAS TRABAJADOS es transitoria: cuando se automatice el cálculo de
  feriados, la materia prima ya va a estar congelada en
  `sth_cierre_dias_trabajados`.
