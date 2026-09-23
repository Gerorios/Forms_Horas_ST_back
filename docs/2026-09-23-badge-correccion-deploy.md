# Deploy — Tarjeta corregida con el estado real de la corrección (2026-09-23)

**Solo Frontend.** PR Frontend #81 (`fix/badge-correccion`, merge `d73eac0`).
Backend sin cambios (sigue en `6058c8c`, sin restart). **Sin DDL, sin cambio de
API.** Plan: `docs/superpowers/plans/2026-09-23-badge-correccion.md`; contexto §94.

Pedido explícito del usuario: "Ok, haz el deploy también y anota lo realizado".

## Ejecutado en misregistros (179.198.99.30, como root vía sudo)

Punto de rollback: front `2991269`.

1. Estado previo: front `2991269`, back `6058c8c`, pm2 ambos `online`, disco 7 %.
2. Frontend: `git pull --ff-only` → `d73eac0`; `package.json`/lock sin cambios;
   `npm run build` → "Compiled successfully in 34.5s".
3. `pm2 restart forms-horas-front` → PID 659826, `online`. El back no se
   reinició (PID 653474).

## Verificación

| Chequeo | Resultado |
|---|---|
| Build front | sin errores; "Corrección rechazada:" presente en `.next/static` |
| `pm2` | front `online` (reiniciado), back `online` (intacto) |
| `/`, `/login`, `/mis-registros` en 127.0.0.1:3000 | 200 |
| Dominio público `/login` | 200 |
| API pública `/api/registros-horas` sin token | 401 |

## Qué cambia para el usuario

En Mis registros, la tarjeta de un rechazo + corrección:
- muestra el estado REAL de la corrección (Pendiente / Aprobado / Desaprobado),
  en vez de "Aprobado" siempre;
- va en verde solo si la corrección está aprobada; si no, en gris;
- si la corrección también se rechazó, muestra "Corrección rechazada: <motivo>"
  en rojo, además del motivo del rechazo original.

Caso que lo disparó: Cristian Urueña, 18/09 (13.5 hs rechazada → corrección
10.5 hs rechazada por "fecha mal informada"); veía "Aprobado" con total 0 hs.

## Rollback

Código solamente: `sudo git -C /var/www/Forms_Horas_ST_Frontend checkout
2991269`, `npm run build`, `pm2 restart forms-horas-front`. Sin datos ni
esquema tocados.
