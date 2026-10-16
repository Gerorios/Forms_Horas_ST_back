# Deploy — Seguridad: punto en el mapa y mapa de reportes (ADR-027, revisión 2026-10-15)

**Estado:** pendiente. Entra a `dev` con los PRs de `feat/seguridad-punto-en-mapa` (back #116, front #94) y a
producción en el próximo release `dev` → `main`. Con cambio de API: back y front se deployan juntos.

Qué entra:

- El autor marca el punto del reporte **en el mapa** (además del GPS); el punto guarda su origen (`gps`/`mapa`).
- Mapas en **vista satelital** (Esri) con botón a calles (OpenStreetMap); buscador con **sugerencias** (Photon) y
  respaldo (Nominatim).
- **Mapa de reportes** en Ranking y tableros (HyS/Admin, `GET /seguridad/mapa`): pines por tipo agrupados, ficha
  con link al reporte, vista de mapa de calor y pantalla completa.

## DDL

Dos scripts, porque la columna y el CHECK van a momentos distintos del deploy:

1. `docs/sql/2026-10-15-seguridad-punto-en-mapa.sql`: columna `origen_punto` en `sth_seg_reportes` (los puntos que
   ya existen quedan como `gps`). **Antes** del back: sin la columna, el back nuevo falla al leer y guardar reportes
   de Seguridad.
2. `docs/sql/2026-10-15-seguridad-punto-en-mapa-check.sql`: el CHECK `chk_seg_reporte_origen_punto`. **Después** de
   reiniciar el back: la columna no tiene default, así que mientras sigue vivo el back viejo los reportes con punto
   se guardan con `origen_punto` NULL y el CHECK los rechazaría (incluida la paralización con GPS). Antes de
   correrlo, `SELECT COUNT(*) FROM sth_seg_reportes WHERE latitud IS NOT NULL AND origen_punto IS NULL` tiene que
   dar 0; si no, rellenar con `'gps'` (el script trae la sentencia).

- **`testing`: el paso 1 se aplicó el 2026-10-15**; falta el paso 2, al mergear a `dev`.
- `Horas_Sertec`: el paso 1 en el release antes del back y el paso 2 después del `pm2 restart` (ver Procedimiento).

## ⚠ Datos de demo en `testing`

El 2026-10-15 se cargaron **39 reportes de demo** en `testing` para mostrar el mapa a los encargados (descripción
que empieza con `[DEMO mapa]`, en Salta, Jujuy, Tucumán y Santiago del Estero, con 25 movimientos de puntos que
mueven el ranking de `testing`). Solo existen en `testing`. Borrarlos cuando ya no hagan falta: movimientos,
involucrados, fotos y auditoría de esos reportes, y después los reportes.

## Procedimiento en misregistros

1. Anotar puntos de rollback: `git rev-parse HEAD` en back y front.
2. Backup de la tabla: `sth_seg_reportes` (id, latitud, longitud, error_metros) a
   `/var/www/backups/seguridad-punto-pre-ddl-<fecha>.json` (modo 600).
3. Back: `git pull --ff-only`; DDL paso 1 con
   `npx prisma db execute --file docs/sql/2026-10-15-seguridad-punto-en-mapa.sql`;
   `npx prisma generate`, `npm run build`, `pm2 restart forms-horas-back --update-env`.
4. DDL paso 2, recién con el back nuevo andando: verificar que
   `SELECT COUNT(*) FROM sth_seg_reportes WHERE latitud IS NOT NULL AND origen_punto IS NULL` da 0 (si no, el
   `UPDATE` del script) y correr `npx prisma db execute --file docs/sql/2026-10-15-seguridad-punto-en-mapa-check.sql`.
5. Front: `git pull --ff-only`, **`npm ci`** (dependencias nuevas: `leaflet`, `react-leaflet`,
   `leaflet.markercluster`, `leaflet.heat`), `npm run build`, `pm2 restart forms-horas-front`.

## Verificación

- `SELECT origen_punto, COUNT(*) FROM sth_seg_reportes GROUP BY origen_punto;` → `gps` en los que tienen punto.
- Nuevo reporte → "Marcarla en el mapa": abre en satélite sobre la provincia elegida, las sugerencias aparecen al
  escribir, y el reporte queda "Ubicación marcada en el mapa". En el panel de HyS se lee "(marcado en el mapa)".
- Como HyS, corregir un reporte → "Corregir en el mapa" → guarda y la auditoría tiene el punto viejo y el nuevo.
- Ranking y tableros → "Ver en el mapa": pines por tipo, ficha con "Ver el reporte", Mapa de calor y Pantalla
  completa (Esc para salir).
- El navegador (no el servidor) tiene que llegar a `server.arcgisonline.com` (satélite), `tile.openstreetmap.org`
  (calles), `photon.komoot.io` (sugerencias) y `nominatim.openstreetmap.org` (respaldo).

## Rollback

Si se aplicó el paso 2, `ALTER TABLE sth_seg_reportes DROP CHECK chk_seg_reporte_origen_punto;`; después
`ALTER TABLE sth_seg_reportes DROP COLUMN origen_punto;` y volver back y front a los commits anotados.
