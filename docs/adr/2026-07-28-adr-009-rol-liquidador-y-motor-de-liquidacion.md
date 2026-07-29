# ADR-009: Rol Liquidador y motor de liquidación

## Contexto

Falta un panel para el rol **Liquidador** (ya anotado como "idea a futuro" en
el glosario) que muestre, por quincena, el total a cobrar de cada empleado:
horas declaradas, categoría UOCRA (tarifa base), régimen de pago, horas
extras, presentismo, bonos no remunerativos (novedades que "generan plus"),
guardias pasivas, viáticos, y un régimen especial "por tantos" (pago por
cantidad, hoy solo aplica a relevamiento de fugas por km).

Se investigó si `snuempleados` (tabla legacy sincronizada externamente, ver
ADR-008) alcanza para esto y **no alcanza**:
- `jornal` solo tiene valores `S`/`N` (booleano), no distingue los 3 regímenes.
- `importe_categoria` está en `0` para la mayoría de las categorías (datos
  incompletos, fuera de nuestro control).

## Decisión

### Alcance de empleados

El panel cubre **todos los empleados activos de `snuempleados`**, tengan o no
`Usuario`/login (la mayoría de los operarios no tienen login — ver ADR-008).
La pantalla de asignación (`/liquidacion/perfiles`) muestra el listado
**completo** de empleados activos (con paginación y búsqueda), para que el
Liquidador los revise y clasifique a todos, uno por uno o en tandas.

La exclusión final del panel de liquidación combina dos casos:
1. **Por omisión** — el empleado todavía no tiene `PerfilLiquidacion`
   asignado (no fue revisado todavía).
2. **Régimen `administrativo`** — fue revisado y se confirmó explícitamente
   que se liquida por otro circuito (fuera de esta app). A diferencia del
   caso 1, acá sí queda una fila en `PerfilLiquidacion` — sirve para que el
   Liquidador vea que ya lo procesó y no lo confunda con un pendiente de
   revisar.

No se deriva ningún caso de campos de texto de `snuempleados` (frágil, fuera
de nuestro control).

### Régimen y categoría — catálogo propio

Se agrega una tabla **`PerfilLiquidacion`** (1:1 con `snuempleados.cuil`, no
con `Usuario.cuil`):
```
cuil (PK, FK a snuempleados)
regimen: jornalizado | fijo | por_tantos | administrativo
categoriaUocraId (FK, nullable — no aplica a "por_tantos" ni "administrativo")
modalidadHoraExtra: en_b | con_descuentos (nullable — no aplica a "administrativo")
```

`administrativo` se agregó como 4to valor de régimen (no como una Categoría
UOCRA más) porque semánticamente no es una tarifa por hora — es "esta
persona no entra en este circuito de liquidación". Con este régimen,
categoría UOCRA y modalidad de hora extra no se piden.

### Patrón recurrente: "tarifa vigente por mes"

Casi todos los montos de este dominio se ajustan mes a mes. Se repite el
mismo patrón de tabla en tres lugares distintos, cada uno versionado por
fecha de vigencia (se toma la fila cuya vigencia es la más reciente ≤ la
fecha de la quincena que se está liquidando):

1. **Tarifa por categoría UOCRA** — `categoriaUocraId, vigenteDesde, importeHora`.
2. **Monto por novedad con plus** — `tipoNovedadId, vigenteDesde, montoPorDia`
   (aplica a Guardia Pasiva, Viáticos, etc. — cualquier `TipoNovedad` con
   `generaPlus = true`).
3. **Rangos de precio por km** ("por tantos", hoy solo relevamiento de fugas)
   — `vigenteDesde, kmDesde, kmHasta (null = sin techo), precioPorKm`. Se paga
   **todo** el total de km al precio del rango en el que cae (no progresivo).
   La cantidad de km **la carga el Liquidador a mano** al momento de liquidar
   (se mide en otra app externa, no en esta) — no se deriva de
   `sth_registro_tareas`.

El multiplicador de hora extra **no** sigue este patrón: es fijo en **1.5**,
no se versiona ni lo carga nadie (se descartó una tabla `IndiceHoraExtra`
que se había armado inicialmente por error).

### Horas extras (régimen jornalizado)

Umbral: **88hs por quincena** (mismo número que el régimen fijo). Lo que
excede se paga como extra: `(horasQuincena - 88) × tarifaCategoria × 1.5`.

### Modalidad de hora extra: "en B" vs "con descuentos"

Dato fijo por empleado (`PerfilLiquidacion.modalidadHoraExtra`), independiente
del régimen: algunos operarios cobran sus horas extras **en B** (pago
informal, sin descuentos) y otros **con descuentos** (como parte del sueldo
formal). Afecta solo cómo se presenta/calcula el neto de las horas extras de
esa persona, no el resto del sueldo.

### Sueldo básico

`tarifaCategoria × min(horasQuincena, 88)` para jornalizado; para fijo es
directamente `tarifaCategoria × 88` (no dependen de declarar horas — de hecho
usualmente no las declaran).

### Presentismo

20% del sueldo básico (con el tope de 88hs ya explicado). Se pierde si en la
quincena hay:
- Una novedad **Ausencia** con `estadoHys = desaprobada` (certificado médico
  inválido o inasistencia sin justificar — HyS la desaprueba).
- Una novedad **Suspensión** (nueva, ver abajo).

Una Ausencia **aprobada** (certificado válido) no afecta el presentismo.

### Nuevo TipoNovedad: Suspensión

Se agrega "Suspensión" al catálogo de tipos de novedad, **sin** requerir
aprobación de HyS (a diferencia de Ausencia) — la carga directamente
Supervisor/JefeContrato/Admin, ya que no depende de un certificado médico.
Su sola presencia en el período quita presentismo.

## Consecuencias

- El cálculo completo (sueldo básico + extras + presentismo + plus de
  novedades + por tantos) requiere leer de múltiples fuentes: `RegistroHoras`
  (horas), `Novedad` (ausencias/suspensión/guardias/viáticos), 3 tablas de
  tarifas versionadas, y la carga manual de km. Se centraliza en un service de
  liquidación que arma esto por empleado y quincena bajo demanda (no se
  persiste un "recibo" calculado — se recalcula cada vez que se abre el
  panel, mientras no se decida lo contrario).
- Quedan fuera de este ADR (a resolver en el detalle de implementación, no
  bloquean el diseño porque son datos, no decisiones de arquitectura): los
  valores concretos de cada tarifa (los carga el Liquidador desde el panel).
- Un "sueldo básico" para régimen `por_tantos` no está definido todavía — hoy
  el único caso conocido (relevamiento de fugas) parece cobrarse **solo** por
  los rangos de km, sin básico aparte. Se confirma en la fase de
  implementación de ese régimen si aparece un caso que lo contradiga.

## Alternativas consideradas

- **Derivar régimen/categoría de `snuempleados.jornal`/`categoria`** —
  descartada: datos insuficientes (jornal es binario) e incompletos
  (importe_categoria en 0 para la mayoría).
- **Cálculo progresivo por tramos de km** — descartada: el usuario confirmó
  que es "todo al precio del rango", no progresivo.
- **Modelar "por tantos" de forma genérica (unidad configurable)** —
  descartada por ahora: hoy es un único caso conocido (km, relevamiento de
  fugas); se generaliza si aparece una segunda variante.
