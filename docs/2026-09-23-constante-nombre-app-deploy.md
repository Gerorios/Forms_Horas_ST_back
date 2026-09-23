# Deploy — Nombre de la app en una sola constante (2026-09-23)

**Solo Frontend.** PR Frontend #83 (`refactor/constante-nombre-app`, merge
`ecaa8e8`). **Sin cambio visible, sin DDL, sin API.** Plan:
`docs/superpowers/plans/2026-09-23-constante-nombre-app.md`; contexto §95.

Pedido explícito del usuario: "deployalo por si acaso también".

## Ejecutado en misregistros (179.198.99.30, como root vía sudo)

Punto de rollback: front `c67ec80`.

1. Frontend: `git pull --ff-only` → `ecaa8e8`; `package.json`/lock sin cambios;
   `npm run build` → "Compiled successfully in 17.5s".
2. `pm2 restart forms-horas-front` → PID 660933, `online`. Back intacto (PID 653474).

## Verificación

| Chequeo | Resultado |
|---|---|
| `/`, `/login`, `/mis-registros` en 127.0.0.1:3000 | 200 |
| Dominio público `/login` | 200; `<title>Central SER&amp;TEC</title>`, "Central SER&TEC", "Sistema Interno", description "Sistema interno de SER&TEC"; ningún "Sertec" — idéntico al deploy de #82 |
| API pública sin token | 401 |

## Rollback

`sudo git -C /var/www/Forms_Horas_ST_Frontend checkout c67ec80`, `npm run
build`, `pm2 restart forms-horas-front`.
