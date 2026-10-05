# ADR-026 — Baja de Operario: bloquea horas, liquida $0 si es previa e informa ausencias al liquidador

**Fecha:** 2026-10-05
**Estado:** Aceptado
**Afecta:** `src/common/baja.ts`, `src/novedades/novedades.service.ts`,
`src/novedades/dto/resolver-novedad.dto.ts`,
`src/registros-horas/registros-horas.service.ts`,
`src/liquidacion/{calculo,panel,cierres,export-cierre,analisis}.service.ts`,
`prisma/schema.prisma` (`CierreLiquidacionDetalle`, DDL manual en
`docs/sql/2026-10-05-baja-de-operario.sql`), frontend (carga de novedades,
`/ausencias`, preliquidación, aprobaciones, control general).

## Contexto

Cuando un operario deja la empresa, la base de sueldos (`snuempleados`, que
mantiene un sistema externo) tarda en marcarlo `activo = 'N'` o no lo marca.
Mientras tanto:

- Se le pueden seguir cargando horas.
- La liquidación lo incluye igual, porque el cálculo toma a todos los que
  tienen perfil de liquidación (no mira `activo`). Un **fijo** cobra 88 hs más
  las pactadas, y un **mensualizado** su sueldo, sin cargar ni una hora:
  nadie se entera.

En producción ya existía un tipo de novedad "Baja de Operario", cargado
desde Admin, pero ningún código lo usaba.

Hay un problema vecino con la misma raíz: a un fijo con ausencias el cálculo
le pone igual 88 hs (la ausencia solo le saca el presentismo), y el Excel del
cierre no informaba ausencias. El liquidador de sueldos descuenta afuera, con
lo que le pasa HyS por otro canal; si no cruza las dos fuentes, paga el
sueldo completo más los días caídos.

## Decisión

1. **Fecha de baja = último día trabajado** (`fechaInicio`; `fechaFin` no
   aplica). Una sola baja vigente por persona.
2. **La confirma HyS** con el circuito de aprobación existente
   (`requiereAprobacionHys`). Pendiente = informada, sin efecto; aprobada =
   confirmada; desaprobada = sin efecto. HyS puede editarla y anularla.
   Corregir la fecha o registrar un reingreso es **anular** la baja (la
   novedad anulada conserva motivo, autor y fecha).
3. **Carga de horas**: con baja confirmada se rechaza cualquier registro con
   fecha posterior, en todos los contratos y para todos los usuarios. Los
   registros posteriores ya cargados se marcan en aprobaciones y en control
   general.
4. **Liquidación**:
   - *Baja previa* (anterior a la quincena): **$0 automático** en todo, en
     cualquier régimen. La fila se muestra en rojo (o en gris si
     `snuempleados` ya la tiene inactiva) y suma una salvedad al cierre.
   - *Baja dentro de la quincena*: montos sin tocar, salvo que nada con
     fecha posterior a la baja se liquida (horas, plus de novedades,
     ausencias, días trabajados). Plus individual y km por tantos se
     respetan, porque los carga el Liquidador a mano.
5. **Cierre y Excel**: se congelan y exportan, en columnas propias al final
   de la hoja, los días de ausencia injustificada, justificada y sin
   resolver (días corridos recortados a la quincena y a la baja) y la fecha
   de baja. El sistema **informa**; el descuento lo sigue haciendo el
   liquidador de sueldos.
6. **Excel solo con quien cobra**: la baja previa queda congelada en el
   cierre (con `activoEnSueldos`, el `snuempleados.activo` al cerrar) pero
   no sale en las hojas de pago ni en el archivo de por tantos. Si al cerrar
   seguía activa en sueldos, va a una hoja **BAJAS A REGULARIZAR** del mismo
   Excel (legajo, nombre, CUIL, localidad, último día trabajado) para que el
   liquidador de sueldos la dé de baja en su sistema. Si ya estaba inactiva,
   no se informa.

## Alternativas consideradas

- **Solo alerta para la baja previa (sin $0)** — descartada. Repite el
  problema que se quiere resolver: depende de que alguien mire el color. El
  error caro es pagarle a alguien que ya no está (recuperar esa plata es
  difícil). El error contrario, no pagarle por una fecha mal cargada, se nota
  enseguida porque el empleado reclama, y se corrige anulando la baja.
- **Descontar automáticamente las ausencias y los días posteriores a la baja
  de un fijo** — descartada. La regla de descuento (qué ausencias se pagan,
  si se descuentan las pactadas, días hábiles o corridos) es del convenio y
  del liquidador de sueldos, no de esta app. Se elige informar en columnas
  numéricas para que haga cuentas en la planilla.
- **Efecto inmediato de la baja, sin confirmación** — descartada por el
  dueño de producto. Con consecuencias tan fuertes (bloqueo y $0), un error
  de persona (dos García en la lista) corta el sueldo de alguien que sigue
  trabajando. HyS es quien se entera de las bajas en la empresa.
- **Sacar de la liquidación a quien tenga `activo = 'N'`** — descartada:
  le quitaría la liquidación final a quien se fue a mitad de quincena si el
  ERP se actualizó rápido.

## Consecuencias

- La app prima sobre `snuempleados.activo` para decidir si se paga: una baja
  confirmada vale aunque la base de sueldos diga activo.
- Las columnas nuevas del detalle son nullables: los cierres anteriores las
  muestran vacías en el Excel (vacío ≠ 0).
- El tipo se reconoce por nombre exacto (`TIPO_BAJA = 'Baja de Operario'`),
  como Ausencia y Suspensión. Renombrarlo desde Admin desactiva la regla.
- Fuera de alcance: dar de alta operarios que todavía no están en
  `snuempleados` (otro problema; se trata aparte).
