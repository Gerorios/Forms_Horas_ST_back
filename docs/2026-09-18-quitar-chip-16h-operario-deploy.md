# Deploy — Quitar el chip "+16h" de Mis registros (operario) (2026-09-18)

PR: Frontend #72 (`fix/quitar-chip-16h-operario`). Backend: solo docs (#81 plan
y contexto §89). **Solo Frontend**: sin cambio de API, sin DDL, el Backend no
se tocó ni se reinició.

## Ejecutado en misregistros (179.198.99.30, como root vía sudo)

Punto de rollback: front `20aa165` (el Backend queda en `5edad46`).

1. `git pull --ff-only` → `8b86d74`; `npm install` sin cambios; `npm run build`
   compilado en 33 s, 38 páginas estáticas generadas.
2. `pm2 restart forms-horas-front`: PID nuevo 616006, `online`.

## Verificación

| Chequeo | Resultado |
|---|---|
| Build | sin errores |
| `pm2 forms-horas-front` | `online` |
| Front `/` | 200 |
| Front `/mis-registros` | 200 |

## Qué cambia para el usuario

El operario ya no ve la marca `+16h` junto a sus horas en "Mis registros". Los
jefes siguen viendo la alerta de jornada larga en aprobaciones y control
general, sin cambios.

## Rollback

`sudo git -C /var/www/Forms_Horas_ST_Frontend checkout 20aa165`, `npm run
build`, `sudo pm2 restart forms-horas-front`.
