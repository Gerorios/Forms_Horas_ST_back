# Deploy — Certificación K12 en Excel + formulario manual (2026-09-21)

PRs: Backend #83 (`fix/cert-k12-provincia-total`, merge `11fcc1a`) y #84 (docs),
Frontend #73 (`fix/cert-form-manual-overflow`, merge `0b4babb`). **Sin DDL, sin
cambio de API.** Contexto §90.

## Ejecutado en misregistros (179.198.99.30, como root vía sudo)

Punto de rollback: back `5edad46`, front `8b86d74`.

1. Backend: `git pull --ff-only` → `f73b3da` (incluye #83 y #84), `npm install`
   sin cambios, `npx prisma generate` (client v7.8.0), `npm run build` sin
   errores.
2. Frontend: `git pull --ff-only` → `0b4babb`, `npm install` sin cambios,
   `npm run build` compilado en 28 s.
3. `pm2 restart forms-horas-back forms-horas-front`: PIDs 640623 / 640636,
   ambos `online`, log "Nest application successfully started".

## Verificación

| Chequeo | Resultado |
|---|---|
| Builds back y front | sin errores |
| `pm2` | ambos `online` |
| Back `POST /certificaciones/carga/preview` sin token | 401 |
| Front `/` y `/certificaciones/carga` | 200 |

## Qué cambia para el usuario

- El Excel del contrato K12 (formato sin columna PROVINCIA, con coeficiente en
  la columna K y fila "TOTAL CERTIFICADO") ahora se lee: 5 filas K12 con su
  total declarado. Las filas quedan bloqueadas por "Falta provincia" hasta que
  la persona elija la provincia **en cada fila** (el archivo no la trae y K12
  opera en cuatro provincias). Un aviso urgente lo dice y recomienda hacerlo.
- El paso 3 muestra **solo avisos urgentes**; desapareció el panel de
  "Avisos de lectura" con columnas ignoradas.
- El formulario "+ Agregar fila manual" ya no se desborda, y su selector de
  ítems lista solo los del contrato de las hojas elegidas.
- La tarjeta TOTAL A CARGAR ya no se sale del recuadro con montos largos.
- Los Excel de Naturgy siguen igual; los PDF no cambian.

## Rollback

Código solamente: `sudo git -C /var/www/Forms_Horas_ST_back checkout 5edad46`
y `sudo git -C /var/www/Forms_Horas_ST_Frontend checkout 8b86d74`, build y
`pm2 restart` de ambos. Sin datos ni esquema tocados.
