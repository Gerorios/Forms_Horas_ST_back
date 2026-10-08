# Deploy: hotfix pastilla "Activo" + bandeja HyS (2026-10-07)

PR: Frontend #89 (merge `efda0f0` en `main`; traído a `dev` por #90). Solo Frontend: sin Backend ni DDL.
Pedido explícito del usuario: "deployá el hotfix". Detalle del cambio: bitácora §104 y
`docs/superpowers/plans/2026-10-07-hotfix-pastilla-activo-y-bandeja-hys.md`.

Punto de rollback: front `9c3d65b`.

## Pasos (VPS 179.198.99.30, usuario `coworker`)

1. Precondición: `/var/www/Forms_Horas_ST_Frontend` en `main`, `9c3d65b`, sin cambios locales.
2. `sudo git pull --ff-only` → `efda0f0`. `package.json`/`package-lock.json` sin cambios (no hizo falta
   `npm install`).
3. `sudo npm run build` → "Compiled successfully".
4. `sudo pm2 restart forms-horas-front`.

## Verificación

| Chequeo | Resultado |
|---|---|
| `https://misregistros.serytec.com.ar/login` y `/admin/usuarios` | 200 |
| pm2 | back y front `online` |
| Log de errores del front | sin entradas nuevas (último cambio del archivo: 2026-10-03; los 9 "Failed to find Server Action" son previos) |

Pendiente de prueba del usuario en producción: en Admin, tocar "Activo" abre la confirmación (y Cancelar no
cambia nada); en Ausencias, la pestaña Pendientes muestra las de quincenas anteriores.

## Rollback

`sudo git -C /var/www/Forms_Horas_ST_Frontend checkout 9c3d65b`, `sudo npm run build` en el front y
`sudo pm2 restart forms-horas-front`. Después volver a `main` cuando se corrija.
