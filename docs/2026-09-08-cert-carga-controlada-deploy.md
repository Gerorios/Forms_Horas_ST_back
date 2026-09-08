# Deploy — Carga de certificaciones controlada (2026-09-08)

PRs: Backend #65 (Etapa A), #66 (Etapa B), #67 (hotfix provincias); Frontend #67 (Etapa C). Spec: `docs/superpowers/specs/2026-09-07-carga-certificaciones-controlada-design.md`. Contexto: §83.

## Ejecutado en misregistros (179.198.99.30, como root vía sudo)
1. `git pull` en `/var/www/Forms_Horas_ST_back` (→ 6030611) y `/var/www/Forms_Horas_ST_Frontend` (→ 8cf8527). Node 22.23.1 (cumple pdfjs).
2. Backup previo al DDL: `/var/www/backups/cert-pre-ddl-2026-09-08.json` (sth_cert_certificaciones 7754 filas, sth_cert_cargas_log 122).
3. DDL `docs/sql/2026-09-07-cert-origen-y-filas-manuales.sql` aplicado en `Horas_Sertec` con un script Prisma (no hay cliente mysql en el VPS). Verificación: 0 filas con origen ≠ 'archivo', total 7754, max(filas_manuales) = 0. También aplicado en `testing` el 2026-09-07.
4. `npm install`, `npx prisma generate`, `npm run build` en back; `npm install`, `npm run build` en front.
5. `pm2 restart forms-horas-back --update-env`; `pm2 restart forms-horas-front`. Ambos online, log "Nest application successfully started".
6. Smoke: `POST /certificaciones/carga/preview` sin token → 401; `GET /certificaciones/carga/items-maestro` sin token → 401; front `/login` → 200. Preview real con token admin y `CERTIFICADOS SERTEC (K8) -agosto 26 -Capex.pdf` (período 2026-08): 8 filas, 7 cuadran, 1 bloqueada (ítem "5" no está en el maestro), total declarado 22.535.210, período 1/8–30/8, NP detectado.

## Rollback
- Código: `git checkout 513cd48` (back) / `2b87039` (front) + build + `pm2 restart`.
- DDL: `ALTER TABLE sth_cert_certificaciones DROP COLUMN origen; ALTER TABLE sth_cert_cargas_log DROP COLUMN filas_manuales;` (el código viejo no las usa). Backup JSON disponible.
