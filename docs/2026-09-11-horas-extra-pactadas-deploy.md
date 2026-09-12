# Deploy — Horas extra pactadas, baja de modalidadPago y excepción de zona (2026-09-11)

PRs: Backend #77, Frontend #70. ADR-023.
DDL: `docs/sql/2026-09-11-perfiles-horas-extra-pactadas.sql` (con migración de
datos) y `docs/sql/2026-09-11-perfiles-zona-override.sql`.

## Ejecutado en misregistros (179.198.99.30, todo como root vía sudo)

Punto de rollback: back `24a893c`, front `12a8aff`.

1. **Foto previa y backup** (antes de tocar nada):
   `/var/www/backups/perfiles-pre-ddl-2026-09-11.json` — 123 filas completas de
   `sth_perfiles_liquidacion`, **incluyendo `modalidad_pago`**: es el único
   respaldo de ese dato para cuando se dropee la columna (paso 2, PR aparte).
   El JSON guarda también la lista de los 11 CUILs en `fijo_105`, que es lo que
   necesita el rollback.

2. **DDL** en `Horas_Sertec`, en una sola conexión con `sql_mode` forzado a
   estricto y guarda antes del `ALTER` del enum.

3. `git pull`, `npm install`, `npx prisma generate`, `npm run build` en el back;
   `npm install`, `npm run build` en el front.

4. `pm2 restart` de ambos. PIDs nuevos 554130 / 554152, ambos `online`, log con
   "Nest application successfully started".

5. **Excepción de zona de MACCHIAROLA** cargada a mano
   (`zona_override='sur'`), que era el pedido puntual.

## Producción resultó distinta de `testing` — el dato importante

| | testing | **Horas_Sertec** |
|---|---|---|
| Perfiles totales | 119 | **123** |
| `fijo_105` | 11 | 11 |
| **`fijo` preexistentes** | **0** | **14** |
| Cierres congelados con `fijo_105` | 11 | **45** |
| `modalidad_pago` (con_desc / en_b / null) | 105 / 1 / 13 | **108 / 1 / 14** |

Los **14 `fijo` de producción** no existían en el ensayo. El script ya los
contemplaba: se migran a `horas_extra_pactadas = 0`, que **conserva exactamente
su comportamiento anterior** (88 puras, sin extra) y no los deja en alerta.

## Verificación

| Chequeo | Resultado |
|---|---|
| Guarda del enum (`COUNT(fijo_105)` antes del ALTER) | 0 ✔ |
| Ex `fijo_105` con 17,5 | **11** (= los que había) |
| `fijo` preexistentes con 0 | **14** (= los que había) |
| Total de perfiles | **123** antes y después |
| `fijo` sin horas cargadas | 0 |
| Filas con el enum vacío (`regimen = ''`) | **0** — el daño silencioso no ocurrió |
| Cierres congelados con `fijo_105` | **45**, intactos |
| Enum resultante | sin `fijo_105` |
| Builds | back y front sin errores |
| `pm2` | ambos `online`, "Nest application successfully started" |
| Front `/` y `/liquidacion/perfiles` | 200 |
| Back `/liquidacion/perfiles` sin token | 401 |

**Montos, contra agosto** (la quincena en curso todavía no tiene tarifas
cargadas, así que da "precio sin resolver" — comportamiento normal):

- Ex `fijo_105`: básico **516.208** (88 × tarifa), extra **153.982,50**
  (17,5 × tarifa × 1,5), presentismo **103.241,60** (20 % del básico).
- `fijo` 88 puro: básico **516.208**, extra **0**.

Cuadra al centavo con la fórmula previa: **nadie cobra distinto**.

**Zona:** MACCHIAROLA (provincia SANTIAGO DEL ESTERO) pasó de "sin zona" a
`sur`; ahora **no queda ningún empleado sin zona** en la quincena.

## Pendiente del usuario

MACCHIAROLA está cargado como **`mensualizado`**. Para que salga con las 100 hs
(88 + 12) hay que cambiarle el régimen a **Fijo** y cargarle **12** en "Horas
extra pactadas", desde Perfiles de empleados.

## Cambios visibles avisados

1. La alerta de **perfiles incompletos baja**: 14 contaban solo por no tener
   modalidad de pago.
2. El **Excel de cierres nuevos** pierde la etiqueta "Hs Extra y Presentismo en
   B / con descuentos" en la columna NOVEDADES (era lo único que producía ese
   campo). Los cierres ya emitidos salen igual. **Ese Excel lo usa el
   liquidador de sueldos, externo.**
3. El total de los 11 ex `fijo_105` pasa a **105,5** donde decía 105 — la suma
   real de 88 + 17,5. Confirmado con el usuario: el 105 era el error.

## Paso 2, pendiente

`DROP COLUMN modalidad_pago` en las dos bases, en un PR aparte, cuando se
verifique producción unos días. Es el único movimiento irreversible; el backup
del punto 1 es el respaldo.

## Rollback

- **Código**: `git checkout 24a893c` (back) / `12a8aff` (front) + build +
  `pm2 restart`.
- **DDL**: el bloque ROLLBACK del script, **por lista de CUILs** (está en el
  JSON del backup), nunca por `WHERE horas_extra_pactadas = 17.5`: después del
  deploy, un `fijo` con 17,5 puede ser una asignación nueva.
- `zona_override`: se dropea sin consecuencias (anotando antes las excepciones
  cargadas, hoy una sola).
