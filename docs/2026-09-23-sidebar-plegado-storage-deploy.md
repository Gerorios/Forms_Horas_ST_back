# Deploy — Barra lateral a prueba de localStorage bloqueado (2026-09-23)

**Solo Frontend.** PR Frontend #84 (`fix/sidebar-plegado-storage`, merge
`4d82676`). **Sin DDL, sin API.** Plan:
`docs/superpowers/plans/2026-09-23-sidebar-plegado-storage.md`; contexto §96.

Pedido explícito del usuario: "ok a todo" (PR, merge y deploy).

## Ejecutado en misregistros (179.198.99.30, como root vía sudo)

Punto de rollback: front `ecaa8e8`.

1. Frontend: `git pull --ff-only` → `4d82676`; `package.json`/lock sin cambios;
   `npm run build` → "Compiled successfully in 34.9s".
2. `pm2 restart forms-horas-front` → PID 661764, `online`. Back intacto (PID 653474).

## Verificación

| Chequeo | Resultado |
|---|---|
| `/`, `/login`, `/mis-registros` en 127.0.0.1:3000 | 200 |
| Dominio público `/login` | 200 |
| API pública sin token | 401 |

## Qué cambia para el usuario

Con el navegador normal, nada. Si el almacenamiento del navegador está
bloqueado o lleno, la barra lateral ya no se cae: arranca desplegada y se
puede plegar en la sesión (sin recordarlo).

## Rollback

`sudo git -C /var/www/Forms_Horas_ST_Frontend checkout ecaa8e8`, `npm run
build`, `pm2 restart forms-horas-front`.
