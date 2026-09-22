# Deploy — totalHorasDia redondeado + rótulos de horas (2026-09-22)

PRs: Backend #91 (merge `0d97ca6`) + #92 (docs, `93729d5`); Frontend #80
(merge `2991269`). **Sin DDL, sin cambio de API** (el campo `totalHorasDia`
sigue igual, solo llega redondeado). Contexto §93.

Pedido explícito del usuario: "Sí, deployá los dos".

## Ejecutado en misregistros (179.198.99.30, como root vía sudo)

Punto de rollback: back `ba62298`, front `0009141`.

1. Estado previo: back `ba62298`, front `0009141`, pm2 ambos `online`, disco 7 %.
2. Backend: `git pull --ff-only` → `93729d5`; `package.json`/lock/prisma sin
   cambios; `npx prisma generate`; `npm run build` sin errores. El `dist`
   contiene el `Math.round` de `totalHorasDia`.
3. Frontend: `git pull --ff-only` → `2991269`; `package.json`/lock sin
   cambios; `npm run build` → "Compiled successfully in 26.1s", 38 páginas.
   Los rótulos nuevos están en `.next/static`.
4. `pm2 restart forms-horas-back forms-horas-front` → PIDs 653474 / 653482,
   ambos `online`; "Nest application successfully started".

## Verificación

| Chequeo | Resultado |
|---|---|
| Builds back y front | sin errores |
| `pm2` | ambos `online` |
| `/`, `/login`, `/mis-registros` en 127.0.0.1:3000 | 200 |
| Dominio público `/login` | 200 |
| API pública `/api/registros-horas` sin token | 401 |

## Qué cambia para el usuario

- Aprobaciones: el "hs ese día" ya no muestra colas como `0.6000000000000001`.
- Inicio: el tile "Horas cargadas" aclara "Incluye pendientes de aprobación".
- Mis registros (operario): la tarjeta grande dice "Horas aprobadas · Nª
  quincena" (antes "Total"), porque suma solo lo aprobado.
- Cargas agrupadas: "Total Nª quincena" + "Incluye pendientes de aprobación".

## Rollback

Código solamente: `sudo git -C /var/www/Forms_Horas_ST_back checkout ba62298`
y `sudo git -C /var/www/Forms_Horas_ST_Frontend checkout 0009141`, build y
`pm2 restart` de ambos. Sin datos ni esquema tocados.
