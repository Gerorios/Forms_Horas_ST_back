# Baja del PortalCertificaciones (2026-09-08) — etapa 5, pasos 4 y 5

Cierre parcial de la etapa 5 del plan de unificación (spec
`docs/superpowers/specs/2026-09-01-unificacion-erp-certificaciones-design.md`).
El módulo de certificaciones vive desde ahora solo en
`misregistros.serytec.com.ar/certificaciones`.

## Relevamiento previo (mismo día, antes de tocar nada)

- El portal **seguía en uso para LECTURA**: requests con respuesta 200 a
  `/certificaciones/resumen`, `/certificaciones/historial`,
  `/analytics/kpis-jefe`, `/analytics/interanual` y
  `/analytics/evolucion-mensual` en los últimos días (log del contenedor).
- La **carga ya había migrado**: última carga por el portal a fin de agosto;
  las del 2026-09-07 entraron por misregistros (se distinguen por el formato
  del `usuario_nombre`: el portal graba "Nombre Apellido", Horas resuelve
  "APELLIDO NOMBRE" desde snuempleados).
- El portal tenía **6 usuarios** y `sth_certificaciones_accesos` en Horas
  **3** (uno por nivel), así que ~3 personas quedaban sin acceso.

**Decisión del dueño de producto:** dar de baja igual y otorgar los accesos
**a demanda**, a medida que las personas los pidan, para controlar quién usa
el sistema nuevo. Queda registrado que la pérdida de acceso fue deliberada.

## Ejecutado

1. **Redirección del dominio.** `/etc/nginx/sites-available/certificaciones.serytec.com.ar`
   reemplazado por dos `server` que devuelven `302` a
   `https://misregistros.serytec.com.ar/certificaciones` (puertos 80 y 443).
   Original respaldado en el mismo directorio como `.bak-20260908`.
   `nginx -t` OK, `systemctl reload nginx`.
   - **302 y no 301, a propósito**: un 301 queda cacheado en los navegadores y
     complicaría el rollback.
   - **Se conservó el bloque SSL** porque certbot renueva este certificado con
     `authenticator = nginx` (necesita el `server` presente).
     `certbot renew --dry-run` → éxito. Vence 2026-11-11 y renueva solo.
2. **Contenedor detenido.** `docker stop portal-certificaciones-back` →
   `Exited (0)`. Política `unless-stopped`, así que no vuelve solo ni al
   reiniciar el daemon. Puerto 8000 libre.
3. **Verificación**: 302 correcto en http, https y rutas profundas
   (`/upload.html`); `misregistros.serytec.com.ar/certificaciones` y `/login`
   siguen en 200.

## Rollback (un minuto)

```
sudo cp /etc/nginx/sites-available/certificaciones.serytec.com.ar.bak-20260908 \
        /etc/nginx/sites-available/certificaciones.serytec.com.ar
sudo nginx -t && sudo systemctl reload nginx
sudo docker start portal-certificaciones-back
```

Los estáticos del portal siguen en `/var/www/PortalCertificaciones_front` y la
imagen del contenedor no se borró.

## NO ejecutado (fuera de la autorización de este cambio)

- Limpieza de secretos del `.env` del portal: `AZURE_CLIENT_SECRET`
  (**rotación pendiente desde agosto**), `OPENAI_API_KEY`, `HORAS_JWT_SECRET`
  (era compartido con misregistros).
- Borrado de las vistas de compatibilidad en `Horas_Sertec`
  (`fact_certificaciones`, `dim_item`, `dim_contrato`, `ma_provincias`,
  `carga_log`, `dim_presupuesto_contrato`) y de la tabla `usuarios` del portal.
- Limpieza de las tablas congeladas en `testing` y archivado del repo.

Este es el paso irreversible del conjunto: conviene hacerlo recién cuando no
quede chance de pedir volver atrás.
