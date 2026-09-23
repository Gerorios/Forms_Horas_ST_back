# Deploy — Marca "Central SER&TEC" y copy "Sistema Interno" (2026-09-23)

**Solo Frontend.** PR Frontend #82 (`fix/nombre-ser-tec`, merge `c67ec80`).
Backend sin cambios, sin restart. **Sin DDL, sin cambio de API.** Plan:
`docs/superpowers/plans/2026-09-23-nombre-ser-tec.md`; contexto §95.

Pedido explícito del usuario: "tienes mi ok para pr merge y deploy".

## Ejecutado en misregistros (179.198.99.30, como root vía sudo)

Punto de rollback: front `d73eac0`.

1. Estado previo: front `d73eac0`, pm2 ambos `online`.
2. Frontend: `git pull --ff-only` → `c67ec80`; `package.json`/lock sin cambios;
   `npm run build` → "Compiled successfully in 34.0s".
3. `pm2 restart forms-horas-front` → PID 660582, `online`. Back intacto (PID 653474).

## Verificación

| Chequeo | Resultado |
|---|---|
| Build front | sin errores |
| `pm2` | front `online` (reiniciado), back `online` (intacto) |
| `/`, `/login`, `/mis-registros` en 127.0.0.1:3000 | 200 |
| Dominio público `/login` | 200; `<title>Central SER&amp;TEC</title>`; "Central SER&TEC" y "Sistema Interno" en el HTML; ningún "Sertec" |
| API pública sin token | 401 |

## Qué cambia para el usuario

- Login: "Central SER&TEC" + "Sistema Interno" (antes "Central Sertec" +
  "Sistema interno de Sertec").
- Barra lateral: "Central SER&TEC" / "Sistema Interno"; el "CS" plegado se
  anuncia como "Central SER&TEC".
- Pestaña del navegador: "Central SER&TEC".

## Rollback

`sudo git -C /var/www/Forms_Horas_ST_Frontend checkout d73eac0`, `npm run
build`, `pm2 restart forms-horas-front`. Sin datos ni esquema tocados.
