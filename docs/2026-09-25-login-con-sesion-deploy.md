# Deploy — /login redirige a quien ya tiene sesión (2026-09-25)

**Solo Frontend.** PR Frontend #86 (`fix/login-con-sesion`, merge `3636ac4`).
**Sin DDL, sin API.** Plan: `docs/superpowers/plans/2026-09-25-login-con-sesion.md`;
contexto §98.

Pedido explícito del usuario: "hacé el PR y mergealo, anotá en el contexto del
proyecto lo realizado, luego deployá" y, tras el bloqueo del SSH, "dale ahora".

## Ejecutado en misregistros (179.198.99.30, como root vía sudo)

Punto de rollback: front `55b3ded`.

1. Frontend: `git pull --ff-only` → `3636ac4`; `package.json`/lock sin cambios;
   `npm run build` → "Compiled successfully in 37.7s".
2. `pm2 restart forms-horas-front` → PID 683862, `online`. Back intacto (PID 653474).

## Verificación

| Chequeo | Resultado |
|---|---|
| `/`, `/login`, `/mis-registros` en 127.0.0.1:3000 | 200 |
| Dominio público `/login` | 200 |

## Qué cambia para el usuario

Si alguien con la sesión abierta entra a `/login`, vuelve a la app en lugar de
ver el formulario (ya no se puede loguear otro usuario encima sin cerrar
sesión). Después de ingresar, "atrás" ya no vuelve al login.

## Rollback

`sudo git -C /var/www/Forms_Horas_ST_Frontend checkout 55b3ded`, `npm run
build`, `pm2 restart forms-horas-front`.
