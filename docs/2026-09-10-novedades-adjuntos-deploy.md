# Deploy — Certificados múltiples en novedades (2026-09-10)

PRs: Backend #71, Frontend #68 (tres commits: certificados, fix del detalle,
paginación). DDL: `docs/sql/2026-09-10-novedades-adjuntos-multiples.sql`.
Mockup aprobado: https://claude.ai/code/artifact/d88e5976-b916-439b-8ae3-57f62e5a6eaf

## Ejecutado en misregistros (179.198.99.30, todo como root vía sudo)

1. Merge de los dos PRs con `--merge --admin` (back `972c2e0`, front `80c681b`)
   y `git pull` en `/var/www/Forms_Horas_ST_back` y
   `/var/www/Forms_Horas_ST_Frontend`. Node 22.23.1.
2. **Backup previo al DDL**: `/var/www/backups/novedades-pre-ddl-2026-09-10.json`
   (92 filas de `sth_novedades`, 5 con `adjunto_url`; `sth_auditoria` en 3355 filas).
3. DDL aplicado en `Horas_Sertec` con un script Prisma (no hay cliente mysql en
   el VPS). Tres sentencias: `CREATE TABLE sth_novedades_adjuntos`, ampliación
   del ENUM `sth_auditoria.accion` y la migración `INSERT ... SELECT`.
   Ya estaba aplicado en `testing` desde el ensayo del 2026-09-10.
4. `npm install`, `npx prisma generate`, `npm run build` en el back;
   `npm install`, `npm run build` en el front.
5. `pm2 restart forms-horas-back --update-env`; `pm2 restart forms-horas-front`.
   Ambos `online`, log "Nest application successfully started".

## Verificación

**Migración** (5 de 5, sin pérdida):

| Chequeo | Resultado |
|---|---|
| `adjunto_url` no nulos vs filas migradas | 5 vs 5 |
| mimetype que cayó al fallback `octet-stream` | 0 |
| novedades que superan el tope de 3 vigentes | ninguna |
| filas de la tabla sin su archivo en disco | 0 de 5 |
| nombre del subidor resuelto en snuempleados | los 3 CUILs resuelven |

Los cinco paths de la tabla coinciden exactamente con los cinco archivos de
`/var/www/forms-horas-adjuntos` (1,1 MB).

**Smoke de la API** (`https://misregistros.serytec.com.ar/api`):

```
401  GET    /novedades/1/adjuntos/1     ← ruta nueva, guard activo
401  PATCH  /novedades/1/adjunto        ← ruta nueva
401  DELETE /novedades/1/adjuntos/1     ← ruta nueva
404  GET    /novedades/1/adjunto        ← ruta vieja, dada de baja a propósito
200  /login, /novedades, /ausencias     ← front
```

## Rollback

- **Código**: `git checkout 0efa9e6` (back) / `2b87039` (front) + build + `pm2 restart`.
- **DDL**: `DROP TABLE sth_novedades_adjuntos;`. `sth_novedades.adjunto_url`
  quedó **poblada y sin uso**, así que el código anterior vuelve a funcionar sin
  restaurar datos. El ENUM ampliado puede quedarse: los valores nuevos no
  molestan al código viejo.
- Backup JSON disponible por si hiciera falta.

## Pendiente

- **Paso 2 de la migración**: `ALTER TABLE sth_novedades DROP COLUMN adjunto_url`,
  en las dos bases, recién cuando se confirme en producción que los certificados
  viejos se abren bien por el camino nuevo. Va en su propio PR.
- Los certificados quedan en el filesystem del VPS (no hay bucket). Con el tope
  de 3 por novedad el crecimiento es acotado; el disco está al 7% (90 GB libres).
