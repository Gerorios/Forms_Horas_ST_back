# Spec: Cierre de liquidación quincenal + export Excel + bono quincenal

> Diseño cerrado con grilling el 2026-08-30. Decisiones de fondo en ADR-021.
> Archivo real de referencia: `Copia de 2026_08_1q_Sueldo SERTEC.xlsx`
> (1ª quincena agosto 2026), en la raíz del repo Backend (no committeado).

## 1. Objetivo

1. Darle infraestructura de persistencia al módulo de Liquidación: hoy todo
   es cálculo en vivo. Nueva capacidad: **cerrar** una quincena = congelar el
   resultado en tablas de hechos versionadas (snapshot puro, sin bloqueo).
2. Generar desde un cierre el **Excel de la preliquidación** que el encargado
   le envía al liquidador de sueldos (reemplaza el armado manual, último
   eslabón del método viejo AppSheet + Power BI + fórmulas).
3. Export **aparte** (del mismo cierre) con los "por tantos" que cobran en B.
4. El analista consume las tablas de hechos por **usuario MySQL de solo
   lectura** (coordinación con IT, fuera del código).
5. **Bono no remunerativo por quincena** (era mensual): UOCRA puede anunciar
   bono para una quincena puntual.

## 2. Modelo de datos (DDL a mano, LAS DOS bases)

### 2.1 `sth_cierres_liquidacion` (cabecera)

| Columna | Tipo | Nota |
|---|---|---|
| id | INT PK AI | |
| anio / mes / quincena | INT | quincena 1 o 2 |
| version | INT | 1, 2, 3… — UNIQUE (anio, mes, quincena, version) |
| cerrado_por_cuil | CHAR(13) FK sth_usuarios | quién cerró |
| nota | VARCHAR(300) NULL | obligatoria en la app si version > 1 |
| salvedades | TEXT NULL | JSON: array de strings con las alertas al cerrar |
| created_at | DATETIME | |

"Vigente" = MAX(version) por (anio, mes, quincena). Sin flag.

### 2.2 `sth_cierre_liquidacion_detalle` (hechos, una fila por empleado)

Todo **congelado** (números/texto copiados al cerrar; `cuil` SIN FK).
UNIQUE (cierre_id, cuil) + INDEX (cuil).

Identificación: cuil CHAR(13), apellido_nombre VARCHAR(70), legajo INT NULL,
provincia VARCHAR(35) NULL, localidad VARCHAR(35) NULL (se congelan LAS DOS —
resuelve el pendiente §6.1 sin re-DDL), zona ENUM('norte','sur') NULL
(NULL = sin zona), regimen VARCHAR(20), categoria VARCHAR(30) NULL,
modalidad_pago VARCHAR(20) NULL.

Valores (DECIMAL(14,2) salvo indicación): horas_total, horas_cct, horas_extra,
precio_bruto (tarifa hora, o sueldo quincenal si mensualizado — como el
archivo real), total_bruto, monto_horas_extra, tiene_presentismo BOOL,
monto_presentismo, no_remunerativo, monto_guardias, monto_productividad,
plus_individual, km_total NULL, monto_km_bruto NULL, monto_a NULL,
monto_b NULL (los 4 últimos solo por_tantos), novedades_texto VARCHAR(500)
NULL, salvedad VARCHAR(300) NULL (el `datoFaltante` de esa fila), total.

### 2.3 `sth_cierre_dias_trabajados`

cierre_id FK, cuil CHAR(13), legajo INT NULL, apellido_nombre VARCHAR(70),
fecha DATE. UNIQUE (cierre_id, cuil, fecha). Un día cuenta si el empleado
tiene ≥1 registro de horas NO desaprobado en esa fecha (⚠ supuesto a validar,
ver §7).

### 2.4 Bono quincenal: `sth_bonos_no_remunerativos`

- Nueva columna `quincena TINYINT NOT NULL`.
- UNIQUE pasa de (categoria_uocra_id, vigente_desde) a
  (categoria_uocra_id, vigente_desde, quincena).
- **Backfill en el mismo DDL**: cada fila existente queda como quincena 1 y
  se inserta su copia con quincena 2 (fiel a lo ya liquidado: el bono mensual
  se pagaba completo en cada quincena).

DDL: `docs/sql/2026-08-30-cierres-liquidacion.sql` (tablas nuevas) y
`docs/sql/2026-08-30-bono-quincenal.sql` (bono + backfill).

## 3. Reglas de negocio

### 3.1 Zona

`zonaDeProvincia(provincia)`: SALTA | JUJUY → 'norte'; TUCUMAN → 'sur';
otro/vacío → null ("sin zona"). Comparación case-insensitive con trim.
Sin zona = chip de alerta en la fila del detalle en vivo, salvedad al cerrar,
y en el Excel sale en la hoja TOTAL pero en ninguna hoja de zona.

### 3.2 Cierre

- Roles: **Liquidador y Admin**.
- Al cerrar: se ejecuta el motor (`CalculoService.calcularQuincena`) + las
  alertas + los días trabajados del rango, y se persiste TODO en una
  transacción. La versión se calcula server-side (MAX+1).
- `nota` obligatoria si ya existe una versión de esa quincena (400 si falta).
- Salvedades grabadas (cabecera JSON + `salvedad` por fila): pendientes de
  aprobar, empleados con horas sin perfil, precios sin resolver, sin km,
  sin zona, bono sin resolver.
- Empleados con horas pero SIN perfil no generan fila de detalle — quedan
  como salvedad de cabecera (igual que hoy no entran a la tabla del panel).

### 3.3 Bono quincenal (calculo)

`CalculoService.calcularQuincena` busca el bono con
`{ vigenteDesde: fechaVigencia, quincena }` (fila exacta del período+quincena,
ADR-018). Endpoints de tarifas de bono ganan `/:quincena`.

## 4. API (roles Admin + Liquidador salvo indicación)

| Método | Ruta | Qué hace |
|---|---|---|
| POST | /liquidacion/cierres | body `{anio, mes, quincena, nota?}` → crea versión nueva; devuelve cabecera |
| GET | /liquidacion/cierres | lista de cabeceras (todas las versiones, orden período desc + version desc) con totales (total gral, por zona, empleados, salvedades count) |
| GET | /liquidacion/cierres/:id | cabecera + detalle congelado completo |
| GET | /liquidacion/cierres/:id/excel | XLSX principal (streaming, Content-Disposition) |
| GET | /liquidacion/cierres/:id/excel-por-tantos | XLSX aparte de por tantos en B |
| GET | /liquidacion/tarifas/bonos/:anio/:mes/:quincena | reemplaza a la ruta sin quincena |
| PUT | /liquidacion/tarifas/bonos/:anio/:mes/:quincena | ídem |

## 5. Excel

Librería: **exceljs** (dependencia nueva del backend). Nombres de archivo:
`{anio}_{mes:2d}_{q}q_Sueldo SERTEC_v{version}.xlsx` y
`{anio}_{mes:2d}_{q}q_PorTantos B_v{version}.xlsx`.

### 5.1 Archivo principal — hojas

1. **TOTAL**: todos los empleados del cierre. 18 columnas, en este orden:
   Legajo · NOMBRE Y APELLIDO · LOCALIDAD (⚠ nombre pendiente §7.1) ·
   CATEGORÍA · TIPO · HORAS TOTAL · HORAS CCT · PRESENTISMO (SI/NO) ·
   PRECIO BRUTO · NO REMUNERATIVO · TOTAL BRUTO · PRODUCTIVIDAD · GUARDIAS ·
   Hs EXTRAS · $$ Hs EXTRAS · $ PRESENTISMO · NOVEDADES · TOTAL.
2. **NORTE**: filas con zona 'norte'. Mismas columnas.
3. **TUCUMAN**: filas con zona 'sur'. Mismas columnas.
4. **RESUMEN**: total $ por localidad + total por zona + total general
   (equivalente estático del "TOTAL TD" dinámico del archivo viejo).
5. **DIAS TRABAJADOS**: matriz empleado × día del período del cierre
   (1 = trabajó), desde `sth_cierre_dias_trabajados`. Transitoria (feriados).

Mapeos de columnas desde el detalle congelado:
- TIPO: jornalizado → "Jornalizado"; mensualizado → "Mensualizado";
  fijo y fijo_105 → "Jornalizado/Mensualizado"; por_tantos →
  "Jornalizado/X Tanto".
- PRESENTISMO: tiene_presentismo → SI/NO. $ PRESENTISMO: monto_presentismo.
- GUARDIAS: monto_guardias (plus de novedades cuyo tipo contiene "guardia",
  case-insensitive) — ⚠ supuesto a validar §7.2.
- PRODUCTIVIDAD: monto_productividad (resto de plus de novedades) +
  plus_individual — ⚠ supuesto a validar §7.2.
- NOVEDADES: novedades_texto. TOTAL: total.
- Los por_tantos aparecen con su blanco (como el archivo real); su monto B
  va SOLO en el archivo aparte.

### 5.2 Archivo aparte por tantos

Una hoja "POR TANTOS B": Legajo · NOMBRE Y APELLIDO · KM · MONTO KM ·
Hs TOTALES · Hs CCT · Hs EXTRA · MONTO A · MONTO B (nomenclatura ADR-019).
Solo filas con regimen por_tantos del cierre.

## 6. Frontend

### 6.1 Botón "Cerrar quincena" (`/liquidacion/quincena/detalle`)

Diálogo de confirmación: "Vas a crear el **cierre v{N}** de la {1ª|2ª}
quincena de {mes} {año}" + totales (total general, NORTE, TUCUMAN/SUR,
cantidad de empleados) + bloque de salvedades en color de alerta + campo nota
(visible y obligatorio solo si N > 1). Confirmar → POST → navegar a
`/liquidacion/cierres` con la fila nueva resaltada.

### 6.2 Pantalla "Cierres" (`/liquidacion/cierres`, ítem nuevo del sub-nav)

Lista **agrupada por quincena**: una fila por período mostrando la versión
vigente (v · fecha/hora · quién · total $ · badge de salvedades · botones
Descargar Excel / Descargar Por Tantos B / Ver detalle). Expandir → versiones
anteriores con lo mismo + su nota. "Ver detalle" abre la tabla congelada en
pantalla (solo lectura, mismas columnas del Excel). Estado vacío: "Todavía no
se cerró ninguna quincena".

Las descargas van con el token (axios responseType blob + guardado client-side).

### 6.3 Tarjeta Bono (pestaña Precios de Tarifas)

Gana **selector de quincena propio** (mismo patrón que la sección Plus
individual — decisión explícita: SIN dobles columnas 1Q/2Q). GET/PUT usan la
ruta nueva con `/:quincena`. El flag `resuelto` y la `sugerencia` son por
quincena.

### 6.4 Alerta "sin zona"

Chip en la fila del detalle en vivo (mismo patrón que `datoFaltante`) +
integrada al bloque de salvedades del diálogo de cierre.

## 7. Pendientes / supuestos a validar con el dueño de producto

1. **Nombre de la columna localidad/provincia** en el Excel: el archivo viejo
   la llama "PROVINCIA" pero trae localidades. El usuario consulta si al
   liquidador le importa; la columna se nombrará por lo que realmente
   contenga. El detalle congela ambas → cambiar el export después es trivial.
2. **Mapeo GUARDIAS / PRODUCTIVIDAD** (§5.1): validar contra el archivo real
   de una quincena cerrada en paralelo por los dos métodos.
3. **Alcance de DIAS TRABAJADOS**: el archivo viejo trae meses anteriores
   (junio en el archivo de 1Q agosto — el cálculo de feriados puede mirar
   hacia atrás). La versión nueva congela SOLO los días de la quincena
   cerrada. Confirmar si alcanza o si feriados necesita más historia.
4. Coordinación con IT: usuario MySQL de solo lectura sobre las 3 tablas
   de hechos para el analista.
