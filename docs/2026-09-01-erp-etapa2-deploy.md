# Deploy ERP etapa 2 — checklist

Pre-requisito: PRs de etapa 2 mergeados en Horas Backend y Frontend. El repo
del portal NO tiene cambios de código en esta etapa (verificarlo igual:
regla de los TRES repos).

1. Backup: mysqldump de las 7 tablas del portal en `testing`
   (fact_certificaciones, dim_item, dim_contrato, ma_provincias, carga_log,
   dim_presupuesto_contrato, usuarios) → guardar en el VPS con fecha.
2. En `Horas_Sertec`: ejecutar la Sección B del script de mudanza
   (docs/sql/2026-09-01-mudanza-certificaciones.sql), descomentada y con el
   prefijo `testing.` en los SELECT de origen. Necesita un usuario MySQL con
   lectura sobre `testing` y DDL sobre `Horas_Sertec`; si el usuario de la
   app no tiene esos grants, pedir a IT o correrlo por partes (dump/restore).
3. Verificar conteos con docs/sql/2026-09-01-mudanza-verificacion.sql
   (en Horas_Sertec las tablas "viejas" son las vistas: conteos iguales por
   definición — la verificación real es contra los conteos anotados de
   `testing` en el paso 1).
4. Repuntar el portal: en /var/www/PortalCertificaciones_back/.env cambiar
   DB_NAME=testing → DB_NAME=Horas_Sertec (backup del .env) y
   `sudo docker compose up -d --force-recreate` (restart NO recarga el .env).
   Smoke del portal: health 200, login propio OK, dashboard con datos.
5. Congelar: a partir de acá las tablas viejas de `testing` quedan stale
   (anotarlo — el snapshot dev sth_cert_* de testing se puede refrescar
   con la Sección A cuando haga falta).
6. Deploy Horas: pull main + npm install + build en ambos repos.
7. AVISO al usuario y `sudo pm2 restart forms-horas-back forms-horas-front`.
8. Smoke Horas: front 200; /api/certificaciones/resumen 401 sin token;
   con un usuario real: Resumen y Analytics con datos.
9. Paridad: para un período cerrado, comparar los totales de
   misregistros/certificaciones vs el portal (mismo monto certificado,
   mismo PGN, misma cantidad de filas de estado de cargas).
10. Limpieza: borrar NEXT_PUBLIC_CERT_API_URL del .env.production del
    frontend (quedó muerta; el build nuevo ya no la lee), sacar
    https://misregistros.serytec.com.ar de ALLOWED_ORIGINS del portal y
    (opcional, recomendado) vaciar HORAS_JWT_SECRET del portal — nada de
    Horas le pega más. Recreate del contenedor del portal.
11. Documentar la sesión: contexto de Horas (sección nueva) y
    CONTEXTO_SISTEMA.md del portal.
