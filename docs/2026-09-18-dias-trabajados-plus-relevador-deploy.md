# Deploy — Hoja DIAS TRABAJADOS con 3 quincenas + plus del relevador a Monto B (2026-09-18)

PRs: Backend #79 (`feat/dias-trabajados-tres-quincenas`, merge `5edad46`),
Frontend #71 (`fix/plus-relevador-monto-b`, merge `20aa165`). ADR-024 (nuevo),
enmiendas en ADR-021 y ADR-019. **Sin DDL.**

## Ejecutado en misregistros (179.198.99.30, todo como root vía sudo)

Punto de rollback: back `ba9c0eb`, front `dd64a30`.

1. Backend: `git pull --ff-only` → `5edad46`, `npm install`, `npx prisma
   generate` (client v7.8.0), `npm run build` sin errores.
2. Frontend: `git pull --ff-only` → `20aa165`, `npm install` (sin cambios),
   `npm run build` sin errores.
3. `pm2 restart forms-horas-back forms-horas-front`. PIDs nuevos 613602 /
   613615, ambos `online`, log con "Nest application successfully started" y
   "Backend corriendo en http://localhost:3001".

No se tocó ninguna base: el cambio solo agrega filas a
`sth_cierre_dias_trabajados` a partir del próximo cierre.

## Verificación

| Chequeo | Resultado |
|---|---|
| Builds back y front | sin errores |
| `pm2` | ambos `online` |
| Back `/liquidacion/cierres` sin token | 401 |
| Front `/` y `/liquidacion` | 200 |
| Errores nuevos en el log del back tras el reinicio | ninguno (los últimos son del 11/9, deploy anterior) |

## Qué cambia para el usuario a partir de ahora

1. **Al cerrar una quincena** se congelan los días trabajados de las 3
   quincenas corridas que terminan en ella. La hoja DIAS TRABAJADOS del Excel
   sale con un bloque por mes calendario y `Total <Mes>` al final de cada
   bloque, sin total general.
2. **Los cierres ya emitidos no cambian**: su hoja sigue mostrando solo su
   quincena y su `montoB` viejo. Para tenerlos con la forma nueva, **recierre
   con nota** desde la pantalla de liquidación (decisión del usuario: no se
   borra ningún cierre de producción; la versión anterior queda intacta,
   ADR-021).
3. **Relevadores (por tantos)**: el plus individual entra en el **Monto B**
   (tabla en vivo, detalle del cierre y Excel POR TANTOS B). En el Excel
   principal, la fila del relevador ya no muestra el plus en PRODUCTIVIDAD.
   Ese Excel lo usa el liquidador de sueldos, externo.

## Pendiente del usuario

- Recerrar las quincenas que el liquidador necesite para feriados.
- Revisar que el **bono no remunerativo de septiembre** esté cargado en
  producción: en `testing` no lo estaba y los Oficiales salían con bono $0
  (visto al revisar la cuenta de un relevador el 2026-09-18).

## Rollback

Código solamente: `sudo git -C /var/www/Forms_Horas_ST_back checkout ba9c0eb`
y `sudo git -C /var/www/Forms_Horas_ST_Frontend checkout dd64a30`, build y
`pm2 restart` de ambos. Las filas extra que un cierre nuevo haya congelado en
`sth_cierre_dias_trabajados` no molestan al código viejo: la hoja las
mostraría en una sola tira de días.
