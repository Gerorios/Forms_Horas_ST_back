# Deploy — Rediseño "Central Sertec" completo + horas con un decimal (2026-09-22)

**Solo Frontend.** PRs Frontend #74 (etapa 1), #75 (etapa 2), #76 (etapa 3a +
fotos reales), #77 (etapa 3b), #78 (etapa 3c) y #79 (fix horas un decimal);
merge final `0009141`. Backend sin cambios de código desde `f73b3da`
(`git diff --stat f73b3da main -- src prisma package.json` vacío): solo docs
(#85-#89), se hizo `git pull` sin build ni restart. **Sin DDL, sin cambio de
API.** ADR-025; contexto §91 y §92.

Pedido explícito del usuario: "avanza con el pr, mergea todo y el deploy en
produccion", tras probar el fix de horas en local.

## Ejecutado en misregistros (179.198.99.30, como root vía sudo)

Punto de rollback: front `0b4babb` (back queda en `f73b3da` + docs, sin
cambio funcional).

1. Estado previo verificado: front `0b4babb`, back `f73b3da`, pm2 ambos
   `online` (26 h de uptime), disco 7 %, 6,9 GB libres de RAM.
2. Frontend: `git pull --ff-only` → `0009141`; `package.json`/lock sin
   cambios; `npm install` sin cambios; `npm run build` → "Compiled
   successfully in 33.1s", 38 páginas estáticas.
3. Backend: `git pull --ff-only` → `ba62298` (solo docs). Sin build ni restart.
4. `pm2 restart forms-horas-front` → PID 651809, `online`, "Ready in 385ms".
   El back no se reinició (PID 640623 sigue).

## Verificación

| Chequeo | Resultado |
|---|---|
| Build front | sin errores |
| `pm2` | front `online` (reiniciado), back `online` (intacto) |
| `/`, `/login`, `/mis-registros`, `/liquidacion/analisis` en 127.0.0.1:3000 | 200 |
| `/fotos/inicio.jpg` y `/fotos/login.jpg` | 200, 383.267 B y 281.715 B |
| `<title>` de `/login` | "Central Sertec" |
| Dominio público `https://misregistros.serytec.com.ar/login` | 200, `<title>` "Central Sertec"; `/fotos/login.jpg` 200 |
| API pública `/api/registros-horas` sin token | 401 (back intacto) |

## Qué cambia para el usuario

- **Nombre y aspecto:** la app pasa a llamarse **Central Sertec**. Barra
  lateral grafito con títulos de área en dorado, plegable, con módulos
  agrupados en Operación / Personas / Resultados operativos /
  Administración. Fondo del contenido arena, tarjetas blancas.
- **Inicio:** franja con foto de la cuadrilla, saludo, fecha y quincena en
  curso; indicadores por rol y una sección por área con tarjetas de acceso.
- **Login:** foto de trabajo en altura a pantalla completa, anclada para que
  el operario quede arriba de la tarjeta oscura del formulario.
- **Encabezados:** cada módulo muestra su área ("Operación · …") en vez del
  rol o el nombre del módulo. Novedades conserva "Las que cargaste vos".
- **Indicadores unificados:** un solo componente de tarjeta de indicador; en
  análisis, resumen y analytics de certificaciones los importes largos bajan
  un escalón de tipografía.
- **Mobile:** las pestañas de Aprobaciones y Ausencias ya no desbordan a
  390 px. Reporte, Mis registros y Combustible verificados en teléfono.
- **Horas con un decimal:** los totales sumados en pantalla (tarjetas de Mis
  registros, "hs totales" por lote, aviso "hs ese día") ya no muestran colas
  como `0.6000000000000001`. Los valores por fila no cambian.
- Nada cambia en reglas de negocio, permisos, API ni datos.

## Rollback

Código solamente: `sudo git -C /var/www/Forms_Horas_ST_Frontend checkout
0b4babb`, `npm run build`, `pm2 restart forms-horas-front`. El Backend no
necesita rollback. Sin datos ni esquema tocados.
