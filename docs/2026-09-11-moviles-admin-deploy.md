# Deploy — Admin > Móviles: buscador, paginado y alta en modal (2026-09-11)

PRs: Backend #75, Frontend #69. **Sin DDL**: ni una migración, ni un `ALTER`.
Planes: `docs/superpowers/plans/2026-09-11-moviles-paginado-filtro.md` y
`2026-09-11-moviles-alta-modal.md`.

## Ejecutado en misregistros (179.198.99.30, todo como root vía sudo)

Punto de rollback anotado antes de tocar nada: back `5937509`, front `80c681b`.
Node 22.23.1.

1. Merge de los dos PRs con `--merge --admin` y `git pull` en
   `/var/www/Forms_Horas_ST_back` y `/var/www/Forms_Horas_ST_Frontend`.
   El back venía un merge atrás (traía además el PR #74, solo docs).
2. `npm install`, `npx prisma generate`, `npm run build` en el back.
3. `npm install`, `npm run build` en el front.
4. `pm2 restart forms-horas-back --update-env`; `pm2 restart forms-horas-front`.

**No hubo backup previo** porque no se tocó ni el esquema ni un solo dato: el
único cambio de Backend es la validación de un DTO.

## Verificación

| Chequeo | Resultado |
|---|---|
| Build del back | `nest build` sin errores |
| Build del front | Next completo, todas las rutas prerenderizadas |
| `pm2 list` | `forms-horas-back` y `forms-horas-front` **online**, PIDs nuevos (550412 / 550435) |
| Log del back | `Nest application successfully started` |
| Front `GET /` | **200** |
| Back `GET /admin/moviles` sin token | **401** (sigue protegido) |
| `@IsNotEmpty` en el build compilado | 2 ocurrencias en `dist/src/admin/dto/catalogo.dto.js` (create y update) |

Quedó **sin verificar en producción** el conteo del pie (`Página 1 de N`): el
script de conteo falló porque el `PrismaClient` 7.8 exige opciones explícitas y
no valía la pena insistir. Se ve al abrir la pantalla. En `testing` daba
`Página 1 de 4 · 79 móviles`.

## Qué mirar en `/admin/moviles`

- El pie con el total, y que "Anterior" arranque deshabilitado.
- `aa 615` (con espacio) tiene que encontrar `AA615NF`.
- `hilux` o `moto` filtran por tipo de vehículo.
- **`TACHO PAÑOL` tiene que seguir apareciendo entero** — es el caso que motivó
  el fix `9671223`.
- El botón `+ Añadir móvil` abre el modal; `Crear` deshabilitado hasta tipear.
- Ya no está el bloque de carga masiva por CSV.

## Cambio de comportamiento a tener presente

`PATCH /admin/moviles/:id` ahora **rechaza vaciar el identificador**
(`@IsNotEmpty`), igual que el alta. Es lo pedido, pero es un endpoint que ya
estaba en uso: si algún flujo mandaba string vacío para "limpiar" el campo,
deja de funcionar. No se encontró ninguno.

`POST /admin/moviles/masivo` **queda vivo sin consumidor**, a propósito: el
Frontend ya no lo llama, pero sirve si alguna vez entra una flota nueva.

## Rollback

`git checkout 5937509` (back) / `80c681b` (front) + `npm run build` +
`pm2 restart`. **Sin datos que restaurar.**
