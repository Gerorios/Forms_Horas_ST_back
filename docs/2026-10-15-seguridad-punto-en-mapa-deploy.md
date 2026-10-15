# Deploy — Seguridad: punto del reporte marcado en el mapa (ADR-027, revisión 2026-10-15)

**Estado:** pendiente. Entra a `dev` con los PRs de `feat/seguridad-punto-en-mapa` (back y front) y a producción
en el próximo release `dev` → `main`. Con cambio de API: back y front se deployan juntos.

## DDL

`docs/sql/2026-10-15-seguridad-punto-en-mapa.sql`: columna `origen_punto` en `sth_seg_reportes` (los puntos que ya
existen quedan como `gps`) y un CHECK.

- `testing`: al mergear a `dev`.
- `Horas_Sertec`: en el release, **antes** del deploy del back. Sin la columna, el back nuevo falla al leer y
  guardar reportes de Seguridad.

## Procedimiento en misregistros

1. Anotar puntos de rollback: `git rev-parse HEAD` en back y front.
2. Backup de la tabla: `sth_seg_reportes` (id, latitud, longitud, error_metros) a
   `/var/www/backups/seguridad-punto-pre-ddl-<fecha>.json` (modo 600).
3. Back: `git pull --ff-only`; DDL con `npx prisma db execute --file docs/sql/2026-10-15-seguridad-punto-en-mapa.sql`;
   `npx prisma generate`, `npm run build`, `pm2 restart forms-horas-back --update-env`.
4. Front: `git pull --ff-only`, **`npm ci`** (dependencias nuevas: `leaflet`, `react-leaflet`), `npm run build`,
   `pm2 restart forms-horas-front`.

## Verificación

- `SELECT origen_punto, COUNT(*) FROM sth_seg_reportes GROUP BY origen_punto;` → `gps` en los que tienen punto.
- Nuevo reporte → "Marcarla en el mapa": el mapa abre en la provincia elegida, la búsqueda encuentra una calle y
  el reporte queda "Ubicación marcada en el mapa". En el panel de HyS se lee "(marcado en el mapa)".
- Como HyS, corregir un reporte → "Corregir en el mapa" → guarda y la auditoría tiene el punto viejo y el nuevo.
- El mapa necesita salida a `tile.openstreetmap.org` y `nominatim.openstreetmap.org` desde el navegador (no desde
  el servidor).

## Rollback

`ALTER TABLE sth_seg_reportes DROP CHECK chk_seg_reporte_origen_punto, DROP COLUMN origen_punto;` y volver back y
front a los commits anotados.
