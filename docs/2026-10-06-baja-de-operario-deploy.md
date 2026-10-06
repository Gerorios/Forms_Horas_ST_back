# Deploy — Baja de Operario (ADR-026) (2026-10-06)

PRs: Backend #105 (merge `5b701cc`), Frontend #88 (merge `9c3d65b`), rama
`feature/baja-de-operario`, escritos por Rodrigo Carrazana. Con cambio de API:
se deployaron juntos. DDL: `docs/sql/2026-10-05-baja-de-operario.sql`. Revisión
y arreglos: `docs/superpowers/plans/2026-10-05-revision-baja-de-operario.md`;
bitácora §103.

Pedido explícito del usuario: "Revisa el pr con el verificador, si no hay
conflictos merge y luego deploya".

## Ejecutado en misregistros (179.198.99.30, como root vía sudo)

Puntos de rollback: back `6071155`, front `3636ac4`.

1. **Precondiciones en `Horas_Sertec`** (script de solo lectura con el driver
   `mariadb`; no hay cliente mysql en la VPS):
   - tipo `id 7`, nombre exacto `Baja de Operario`, `requiere_aprobacion_hys = 0`;
   - 2 bajas cargadas, las dos `activa` / `no_aplica` (ids 160 y 187, último día
     trabajado 29/09 y 05/10);
   - ninguna persona con dos bajas vigentes;
   - `sth_cierre_liquidacion_detalle`: 935 filas, sin las columnas nuevas.
2. **Backup**: `/var/www/backups/baja-pre-ddl-2026-10-06.json` (modo 600): las
   precondiciones y las filas completas de las bajas que toca el UPDATE.
3. Back: `git pull --ff-only` → `5b701cc` (además de la feature, solo docs;
   `package.json` sin cambios).
4. **DDL** con `npx prisma db execute --file docs/sql/2026-10-05-baja-de-operario.sql`
   → "Script executed successfully". En `testing` ya estaba aplicado desde el
   2026-10-05.
5. Back: `npx prisma generate`, `npm run build`,
   `pm2 restart forms-horas-back --update-env` → "Nest application successfully
   started".
6. Front: `git pull --ff-only` → `9c3d65b`, `npm run build` ("Compiled
   successfully"), `pm2 restart forms-horas-front`.

## Verificación

| Chequeo | Resultado |
|---|---|
| Columnas nuevas del detalle | las 6, todas NULL |
| Filas del detalle | 935 (igual que antes) |
| Tipo `Baja de Operario` | `requiere_aprobacion_hys = 1` |
| Bajas en `no_aplica` | 0; las 2 pasaron a `pendiente` |
| Leer un detalle de cierre viejo con el cliente Prisma nuevo | OK, 36 campos, los nuevos en null |
| `/login`, `/novedades`, `/ausencias`, `/liquidacion` (dominio público) | 200 |
| `/api/novedades`, `/api/liquidacion/cierres`, `/api/registros-horas` sin token | 401 |
| pm2 | back y front `online`, sin errores nuevos en el log |

## Qué cambia para el usuario

- Las 2 bajas ya cargadas aparecen **pendientes en la bandeja de HyS**. Hasta
  que HyS las confirme no tienen efecto. Al confirmarlas, esas personas no
  pueden cargar horas después del último día trabajado, y en las quincenas
  posteriores se liquidan en $0.
- Supervisores: al informar una baja, la fecha es el último día trabajado, y
  antes de enviarla se pide confirmar la persona.
- Preliquidación: filas en rojo, gris o amarillo según la baja; días de
  ausencia en el detalle; la columna Plus incluye el plus individual.
- Excel del cierre: 4 columnas nuevas al final y la hoja BAJAS A REGULARIZAR
  cuando corresponde.

## Rollback

- **Código**: `sudo git -C /var/www/Forms_Horas_ST_back checkout 6071155` y
  `sudo git -C /var/www/Forms_Horas_ST_Frontend checkout 3636ac4`, después
  `npx prisma generate` y `npm run build` en el back, `npm run build` en el
  front, y `pm2 restart` de los dos. Las columnas nuevas pueden quedar: el
  código viejo no las usa.
- **DDL**: el bloque ROLLBACK del archivo SQL. Solo sirve antes de que HyS
  confirme bajas y antes de que se emita un cierre con el código nuevo. Los
  estados originales de las 2 bajas están en el backup.
