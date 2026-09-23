# Deploy — Token de sesión a prueba de localStorage bloqueado (2026-09-23)

**Solo Frontend.** PR Frontend #85 (`fix/token-storage`, merge `55b3ded`).
**Sin DDL, sin API.** Plan: `docs/superpowers/plans/2026-09-23-token-storage.md`;
contexto §97.

Pedido explícito del usuario: "dale con todo, pr merge y deploy".

## Ejecutado en misregistros (179.198.99.30, como root vía sudo)

Punto de rollback: front `4d82676`.

1. Frontend: `git pull --ff-only` → `55b3ded`; `package.json`/lock sin cambios;
   `npm run build` → "Compiled successfully in 35.1s".
2. `pm2 restart forms-horas-front` → PID 663036, `online`. Back intacto (PID 653474).

## Verificación

| Chequeo | Resultado |
|---|---|
| `/`, `/login`, `/mis-registros` en 127.0.0.1:3000 | 200 |
| Dominio público `/login` | 200 |
| API pública sin token | 401 |

## Qué cambia para el usuario

Con el navegador normal, nada. Si el almacenamiento del navegador está
bloqueado o lleno, el login ya no falla: la sesión dura mientras la pestaña
esté abierta (al recargar pide login de nuevo) y nunca revive la sesión de
otro usuario que haya quedado guardada.

## Rollback

`sudo git -C /var/www/Forms_Horas_ST_Frontend checkout 4d82676`, `npm run
build`, `pm2 restart forms-horas-front`.
