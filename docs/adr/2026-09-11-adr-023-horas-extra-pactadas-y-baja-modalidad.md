# ADR-023 — Horas extra pactadas por perfil (unifica `fijo`/`fijo_105`) y baja de `modalidadPago`

**Fecha:** 2026-09-11
**Estado:** Aceptado
**Supera:** ADR-020 (régimen `fijo_105`)
**Afecta:** `prisma/schema.prisma` (enum `RegimenLiquidacion`, `PerfilLiquidacion`,
DDL manual en las dos bases), `calculo.service.ts`, `panel.service.ts`,
`analisis.service.ts`, `cierres.service.ts`, `liquidacion.service.ts`,
`dto/liquidacion.dto.ts`, y en el frontend el formulario de Perfiles.

## Contexto

Los regímenes "fijos" se venían modelando como un valor de enum por cada
arreglo. Hasta hoy había dos:

| Régimen | Horas base (CCT) | Horas extra | Personas |
|---|---|---|---|
| `fijo` | 88 | 0 | 0 |
| `fijo_105` | 88 | 17,5 | 11 (todos Ayudante) |

El 2026-08-25, hace diecisiete días, el ADR-020 agregó `fijo_105` tocando siete
archivos más un DDL manual. Ahora entró **MACCHIAROLA**, con un arreglo que da
**88 + 12 = 100 hs**, y haría falta repetir el mismo trámite para un tercer
valor. El pedido del dueño del producto fue explícito: *"en vez de harcodear
(dijo 88 o fijo 105) que el liquidador pueda crear la regla con la que se
pagará"*.

Mirando los tres casos juntos se ve que **no son tres reglas: son una sola con
un número distinto**. Todo lo demás es idéntico — básico = tarifa × 88, extra =
horas × tarifa × 1,5, presentismo sobre el básico, bono y plus por la vía
genérica.

## Decisión

### 1. Las horas extra son un dato del perfil, no un régimen

`PerfilLiquidacion.horasExtraPactadas` (`DECIMAL(5,2)`, nullable). El régimen
`fijo` las lee de ahí. `fijo_105` **desaparece del enum** y sus 11 perfiles
migran a `fijo` + 17,5 por UPDATE.

Se llaman **pactadas** porque salen de un arreglo con RRHH, no del convenio ni
de lo trabajado.

### 2. Se guardan HORAS, no el monto

El total sale de dividir el monto arreglado por el valor hora de una categoría,
pero **esa cuenta la hace el Liquidador afuera** y el sistema guarda el
resultado en horas.

Si se guardara el monto, cada aumento de convenio bajaría las horas del recibo
para que la plata diera igual — justo lo contrario de lo que exige UOCRA, que
es una cantidad de horas estable. Guardando horas, un aumento sube lo que la
persona cobra, igual que a cualquier jornalizado.

### 3. Campo por perfil, no catálogo de regímenes

Se evaluó un catálogo reutilizable ("FIJO 105 HS" creado una vez y asignado a
los 11). Se eligió el campo por perfil: menos maquinaria, y el arreglo es
intrínsecamente individual aunque hoy once coincidan. **Contra conocida:** si
mañana cambia el arreglo del grupo de Ayudantes hay que editar once fichas.

### 4. Sin versionado: se pisa

El valor no lleva `vigenteDesde`. Un cierre de quincena (ADR-021) **congela
todo**, así que cambiar el número no altera ninguna quincena ya cerrada. Es el
mismo comportamiento que ya tienen categoría y régimen.

### 5. `null` es "falta cargarlo"; `0` es una respuesta

- `null` → `datoFaltante` en la fila (*"Falta cargar las horas extra pactadas
  (Perfiles de empleados)"*) y el perfil cuenta como incompleto. El básico de
  88 **se calcula igual**: se muestra lo cierto y se avisa lo que falta, nunca
  se inventa un extra.
- `0` → las 88 puras, sin alerta. Es el viejo `fijo`.

### 6. Las 88 y el ×1,5 NO se hacen configurables

Son del convenio, y las 88 se usan además como tope de `jornalizado` y en
`por_tantos`. Hacerlas editables abriría inconsistencias entre regímenes sin
que nadie lo haya pedido.

### 7. Se elimina `modalidadPago`

El dueño del producto lo pidió: *"quita modalidad de pago, porque no se está
usando y no se usará"*. Se verificó que **no entra en ningún cálculo de
montos**: solo generaba una etiqueta informativa ("Hs Extra y Presentismo en
B / con descuentos"), contaba como perfil incompleto si faltaba, y viajaba al
panel y al cierre.

Se pierden a propósito 105 marcas `con_descuentos` y **1 `en_b`**. Nadie cobra
distinto por esto.

**Dos efectos colaterales asumidos:**
- La alerta de "perfiles incompletos" baja de conteo (13 perfiles la tenían
  null y contaban como incompletos solo por eso).
- La columna NOVEDADES del Excel y `novedadesTexto` de los cierres **nuevos**
  pierden esa etiqueta. Los cierres ya emitidos salen igual que siempre.

### 8. Lo congelado no se toca

`CierreLiquidacionDetalle` conserva su columna `modalidadPago` y sus 11 filas
con `regimen='fijo_105'`: son fotos de recibos ya emitidos. Ahí `regimen` es
`VarChar`, no el enum, así que no hay conflicto.

Por eso **`export-cierre.service.ts` conserva la clave `fijo_105`** en
`TIPO_POR_REGIMEN`: sin ella, el Excel de un cierre viejo imprimiría
`fijo_105` crudo en la columna TIPO.

### 9. El total pasa a ser la suma real: 105,5, no 105

`fijo_105` guardaba `horasTotal = 105` escrito a mano, mientras que sus propias
partes daban `88 + 17,5 = 105,5`. La incoherencia está congelada en los cierres
ya emitidos (`horas_total = 105.00` junto a `horas_extra = 17.50`).

Ahora `horasTotal = 88 + horasExtraPactadas` siempre. **Confirmado con el dueño
del producto el 2026-09-11**: el total correcto es 105,5, el 105 era el error.
La plata no cambia — el monto siempre se calculó con 17,5.

Para el caso nuevo no hay ambigüedad: 88 + 12 = 100 exacto.

### 10. Excepción de zona por persona (`zonaOverride`)

La zona del Excel se deriva de la provincia (ADR-021 §4: NORTE = Salta +
Jujuy, SUR = Tucumán). Apareció un empleado con provincia **SANTIAGO DEL
ESTERO**, que no mapea a ninguna de las dos: **no salía en ninguna hoja** del
Excel, solo como salvedad "sin zona". Por acuerdo tiene que salir en la hoja
de Tucumán.

Se evaluó mapear la provincia entera al SUR. **El dueño del producto eligió la
excepción por persona**: el acuerdo es de esa persona, no de la provincia, y
mapearla obligaría a todos los futuros empleados de Santiago del Estero a la
hoja del sur sin que nadie lo haya decidido.

- Campo nuevo `PerfilLiquidacion.zonaOverride` (`ENUM('norte','sur')`,
  nullable). `null` — el caso de los 119 perfiles de hoy — significa "manda la
  provincia".
- La regla vive en **una sola función**, `zonaDePerfil(provincia, override)`.
- **El cálculo resuelve la zona una vez** y la deja en la fila; el panel, los
  cierres y el Excel la leen de ahí. Antes cada uno llamaba a
  `zonaDeProvincia` por su cuenta: con tres lugares decidiendo lo mismo,
  cualquiera que se olvidara del override se saltearía la excepción.
- Igual que las horas pactadas, **solo se escribe si viene en el body**: editar
  otra cosa del perfil no borra la excepción. Para quitarla hay que mandar
  `null` explícito (la opción "no cambiar" del formulario no la toca).

DDL: `docs/sql/2026-09-11-perfiles-zona-override.sql`. Agrega una columna
nullable, no toca ninguna fila, y el rollback es dropearla.

## Por qué esto revierte al ADR-020

El ADR-020 consideró y descartó esta misma solución: *"Reusar `fijo` con un
flag… se descartó a favor de un régimen nuevo"*. Era razonable con dos casos:
un nombre por régimen es más explícito que un número suelto.

Lo que cambió es la aparición del tercero. Con tres arreglos distintos y sin
razón para pensar que no habrá un cuarto, el costo de un valor de enum por
persona (siete archivos, un DDL y un deploy cada vez) supera al de un campo.

## Riesgo principal, y cómo se acotó

Achicar un ENUM de MySQL **no es como ampliarlo**. Si al `ALTER` quedara una
fila con el valor removido, el servidor —que está en
`sql_mode = IGNORE_SPACE,NO_ENGINE_SUBSTITUTION`, **sin `STRICT_TRANS_TABLES`**—
la convierte en `''` **en silencio**, y esa persona desaparece del cálculo.

Tres defensas en el script (`docs/sql/2026-09-11-perfiles-horas-extra-pactadas.sql`):

1. Fuerza `STRICT_TRANS_TABLES` en su propia sesión: si algo quedó mal, error
   1265 en vez de dato corrupto.
2. Una guarda que aborta si `COUNT(fijo_105) != 0` antes del `ALTER`.
3. Rollback por **lista de CUILs** (nunca por `WHERE horas_extra_pactadas = 17.5`:
   después del deploy un `fijo` con 17,5 puede ser una asignación nueva).

Ensayado en `testing` el 2026-09-11: aplicado, revertido y vuelto a aplicar,
con los 11 intactos y 119 filas en todos los pasos.

## Alternativas consideradas

- **Catálogo de regímenes fijos** (decisión 3): descartado por el dueño del
  producto a favor del campo por perfil.
- **Guardar el monto pactado** y despejar las horas cada quincena (decisión 2):
  descartado porque haría variar las horas del recibo con cada aumento.
- **Hacer configurables las 88 o el ×1,5** (decisión 6): fuera de alcance, son
  del convenio.
- **Versionar el campo** con `vigenteDesde` como los sueldos mensualizados
  (decisión 4): innecesario, el cierre ya congela.
