# Deploy — Autogestión de la Seguridad (ADR-027) y Lanzamiento de módulos (ADR-028)

**Estado:** procedimiento escrito el 2026-10-14, **sin ejecutar**. Se ejecuta en el
release `dev` → `main` (`docs/flujo-de-ramas.md`), no al mergear a `dev`.

Rama `feat/autogestion-seguridad` en back y front, PRs contra `dev`. HyS aprobó la
feature el 2026-10-08 y la segunda vuelta de prueba el 2026-10-14. Con cambio de
API: back y front se deployan juntos.

DDL (los tres ya aplicados en `testing`; en `Horas_Sertec`, ninguno):

1. `docs/sql/2026-10-07-autogestion-seguridad.sql` — 7 tablas `sth_seg_*` y sus catálogos.
2. `docs/sql/2026-10-08-seguridad-ajustes.sql` — ajustes de la revisión con HyS.
3. `docs/sql/2026-10-08-lanzamiento-de-modulos.sql` — 3 tablas `sth_modulos_*` y
   Seguridad registrada como **Interno** con el rol HyS.

**En ese orden y antes del deploy del backend.** Sin las tablas `sth_modulos_*`,
`GET /auth/perfil` falla y nadie puede entrar a la app.

## Procedimiento en misregistros (179.198.99.30)

1. **Anotar puntos de rollback**: `git rev-parse HEAD` en
   `/var/www/Forms_Horas_ST_back` y `/var/www/Forms_Horas_ST_Frontend`.
2. **Precondiciones en `Horas_Sertec`** (script de solo lectura con el driver
   `mariadb`; no hay cliente mysql en la VPS): que no exista ninguna tabla
   `sth_seg_*` ni `sth_modulos_*`. Las tablas son nuevas: no hay filas que
   respaldar, pero se guarda el resultado en
   `/var/www/backups/seguridad-pre-ddl-<fecha>.json` (modo 600).
3. **Carpeta de fotos**: crear `/var/www/storage/seguridad` (dueño: el usuario de
   pm2, modo 750) y agregar al `.env` del back
   `SEGURIDAD_FOTOS_DIR=/var/www/storage/seguridad`. Sin la variable, las fotos
   quedan en `./storage/seguridad` dentro del repo. **Sumarla al backup** junto
   con los adjuntos de novedades: las fotos de los reportes no están en la base.
4. Back: `git pull --ff-only` (con `main` ya mergeado), `npm ci` si cambió
   `package.json`.
5. **DDL**, uno por uno y en orden, con
   `npx prisma db execute --file docs/sql/<archivo>.sql`.
6. Back: `npx prisma generate`, `npm run build`,
   `pm2 restart forms-horas-back --update-env` → "Nest application successfully started".
7. Front: `git pull --ff-only`, `npm run build`, `pm2 restart forms-horas-front`.

## Verificación

| Chequeo | Esperado |
|---|---|
| Tablas `sth_seg_*` / `sth_modulos_*` | 7 / 3 |
| `sth_modulos_lanzamiento` | Seguridad en `interno`; rol HyS en `sth_modulos_piloto_roles` |
| Login y `/` (dominio público) | 200; el inicio carga para un operario |
| `/api/seguridad/...` con un usuario fuera del piloto | 403 |
| Admin → Lanzamientos | muestra Seguridad, Interno, HyS |
| Usuario HyS | ve Seguridad; crea un reporte con foto y la foto queda en `SEGURIDAD_FOTOS_DIR` |
| pm2 | back y front `online`, sin errores nuevos en el log |

## Después del deploy

- Admin suma al piloto a las personas que pida HyS (Administración → Lanzamientos).
- Cuando se decida abrirlo a todos: pasar Seguridad a **Para todos** desde la
  misma pantalla. Es un cambio de datos, sin deploy.
- Quedaron abiertos con HyS: accidente y tolerancia 0, y una pantalla de
  auditoría de sus correcciones.

## Rollback

- **Código**: `git checkout <punto de rollback>` en los dos repos,
  `npx prisma generate` y `npm run build` en el back, `npm run build` en el
  front, `pm2 restart` de los dos. El código viejo no lee las tablas nuevas: se
  pueden dejar.
- **DDL**: el bloque ROLLBACK de cada archivo, en orden inverso (lanzamiento →
  ajustes → seguridad). Borra los reportes y puntos cargados: solo antes de que
  haya datos reales del piloto, y con el OK del usuario.
