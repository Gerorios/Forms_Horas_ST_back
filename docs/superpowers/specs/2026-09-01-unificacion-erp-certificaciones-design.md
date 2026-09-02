# Unificación ERP — Certificaciones como módulo de Horas (etapas 2–5)

> Diseño aprobado en chat el 2026-09-01. La etapa 1 (accesos, claim `cert`,
> incidencia de MO, resumen/analytics vía `apiCert`) ya está EN PRODUCCIÓN
> (Horas back #52, front #58; portal #49).

## 1. Objetivo y estado final

Migrar el PortalCertificaciones (FastAPI + frontend vanilla, Docker en el
VPS) **completo** a la app de Horas, como un módulo más (al nivel de
Liquidación, Novedades, Combustible). Reemplazo total: al final del camino

- una sola app en `misregistros.serytec.com.ar`, un solo login, un solo stack
  (NestJS + Next.js), un solo deploy (PM2);
- se apagan: el backend FastAPI (Docker), el frontend vanilla, la tabla
  `usuarios` del portal y el secreto `HORAS_JWT_SECRET`;
- `certificaciones.serytec.com.ar` queda como redirect a
  `misregistros.serytec.com.ar/certificaciones` (o se da de baja).

## 2. Estrategia: estranguladora, por etapas

Cada etapa es un PR chico y deployable con el flujo habitual (mostrar → OK →
rama → PR → merge `--admin` → deploy explícito). El portal sigue vivo y
operativo durante toda la transición; en cada etapa el módulo de Horas le
quita una responsabilidad. Sin big-bang.

## 3. Datos

- Las tablas del portal (`fact_certificaciones`, `dim_item`, `dim_contrato`,
  `ma_provincias`, `carga_log`) viven en la base **`testing`** del servidor
  MySQL compartido (verificado en el `.env` del VPS el 2026-09-01: el portal
  usa `DB_NAME=testing` en producción — ojo con la confusión: esa base es
  "de pruebas" para Horas pero es la producción del portal). **NO existen en
  `Horas_Sertec`.**
- Prisma no puede mapear modelos de otra base con `@@map` (un datasource =
  una base), así que **el primer paso de la etapa 2 es mudarlas una única
  vez a `Horas_Sertec`**: copia de tablas + datos (`mysqldump` o
  `CREATE TABLE ... SELECT` equivalente), verificación de conteos, backup, y
  repuntar el portal (`DB_NAME=testing` → `Horas_Sertec` en su `.env`, con
  recreate del contenedor — no alcanza el restart). Así el portal y el módulo
  de Horas siguen leyendo/escribiendo LOS MISMOS datos durante toda la
  transición, y los modelos Prisma se agregan normalmente con `@@map`.
- **Renombre en la mudanza** (aprobado 2026-09-01): las tablas adoptan la
  convención `sth_` de la app, con sub-prefijo `sth_cert_` para agruparlas
  y evitar choques (`sth_contratos` es de Horas;
  `sth_certificaciones_accesos`/`_contratos` ya son del módulo de accesos):

  | Tabla del portal | Nombre en `Horas_Sertec` |
  |---|---|
  | `fact_certificaciones` | `sth_cert_certificaciones` |
  | `dim_item` | `sth_cert_items` |
  | `dim_contrato` | `sth_cert_contratos` |
  | `ma_provincias` | `sth_cert_provincias` |
  | `carga_log` | `sth_cert_cargas_log` |
  | `dim_presupuesto_contrato` | `sth_cert_presupuestos` |
  | `usuarios` | `usuarios` (sin renombrar — muere en etapa 5) |

  (Corrección 2026-09-01, tras inventariar el código real del portal: se
  suman `dim_presupuesto_contrato` — la usa `/analytics/presupuesto` — y
  `usuarios` — el login propio del portal la necesita en la base a la que
  apunte.)

  **El portal NO se toca**: casi todo su acceso a datos es SQL crudo con los
  nombres viejos (su `models.py` solo mapea 2 tablas), así que renombrar
  editando su código implicaría reescribir todos sus routers. En su lugar,
  la mudanza crea en `Horas_Sertec` **vistas de compatibilidad** con los
  nombres viejos (`CREATE VIEW fact_certificaciones AS SELECT * FROM
  sth_cert_certificaciones`, etc. — vistas de tabla única, actualizables:
  los INSERT de la carga del portal siguen funcionando). El portal solo
  repunta su `DB_NAME`. Las vistas se eliminan en la etapa 5 junto con el
  portal.
- Las copias que queden en `testing` tras la mudanza se conservan un tiempo
  como respaldo y después se limpian (etapa 5), para que no haya dos fuentes
  de verdad.
- Si alguna etapa requiere DDL nuevo, va a las DOS bases (`Horas_Sertec` y
  `testing`), como siempre.
- ⚠️ El `Contrato` de Horas (`sth_contratos`) y `dim_contrato` del portal son
  tablas distintas con ids distintos. **El cruce entre ambos mundos es SIEMPRE
  por código K, nunca por id.**
- ⚠️ Prisma en este repo no tiene baseline: contra la BD compartida solo
  `prisma migrate deploy` (o `db execute` + `migrate resolve`), NUNCA
  `migrate dev` / `db push` (ver `prisma/migrations/README.md`).

## 4. Usuarios y permisos

- Los usuarios se unifican en los de Horas (`sth_usuarios`). La tabla
  `usuarios` del portal muere con el portal.
- El acceso al módulo ya existe (etapa 1): `sth_certificaciones_accesos`
  (nivel `admin` | `carga` | `lectura` + flag `verIncidencia`) +
  `sth_certificaciones_contratos` (Ks habilitados), administrado desde
  `Admin → Accesos a Certificaciones`.
- Mapeo de roles del portal: admin → `admin`, jefe de contrato → `carga`
  (con sus Ks), gerente → `lectura`.
- Semántica de los niveles: `carga` ve solo sus Ks (sin "sin asignar", sin
  estado operativo, incidencia solo con flag) y en etapa 4 podrá subir
  certificaciones de sus Ks; `lectura` ve todo sin modificar; `admin` ve todo
  y opera todo (carga de cualquier K, maestro de ítems).

## 5. Etapas

### Etapa 2 — Lectura servida por NestJS (muere `apiCert`)

Portar a NestJS los endpoints de solo-lectura que hoy sirve FastAPI a las
pantallas de Horas: resumen, analytics (evolución mensual, por contrato,
interanual, por provincia, top ítems, estado de cargas), historial de cargas
y presupuesto. Modelos Prisma de las tablas del portal. El frontend de Horas
cambia `apiCert` → `api` (mismos shapes o adaptados). Al final de la etapa:
ninguna pantalla de Horas pega al FastAPI; se retiran `NEXT_PUBLIC_CERT_API_URL`,
el CORS de misregistros en el portal y el uso del claim `cert` por parte del
portal (el portal vuelve a ser solo para sus propios usuarios).

Criterio de paridad: para un mismo período, los números del módulo de Horas
== los del portal (verificación manual sobre producción + tests con datos
sintéticos).

### Etapa 3 — Maestro de ítems

ABM de `sth_cert_items` (ítems con ptos_gasnor y contrato asignado) como pantalla
del módulo (solo nivel `admin`), estilo pantallas de Admin de Horas.

### Etapa 4 — Carga de certificaciones

La parte pesada: subir Excel/PDF, parser y validación portados de Python a
Node (exceljs ya está en el backend por liquidación), escritura en
`sth_cert_certificaciones` + `sth_cert_cargas_log`. Visibilidad: `carga`
solo sobre sus Ks.

- **Tests de paridad obligatorios**: mismos archivos reales de entrada →
  mismas filas resultantes que el parser Python (fixtures tomadas del
  histórico de `carga_log`).
- **Decisión OneDrive (RESUELTA 2026-09-02 por el usuario): se ELIMINA y no
  se guarda copia en ningún lado.** El archivo subido se parsea, se cargan
  las filas y queda el registro en `carga_log` (nombre de archivo, filas,
  estado, errores); los bytes se descartan. Ventajas: cero dependencia de
  Azure (el secreto vencido se abandona), y el flujo preview→confirmar no
  necesita retener el archivo. La carpeta histórica de OneDrive queda como
  archivo muerto.

### Etapa 5 — Apagado del portal

1. Alta en Horas de los jefes/gerentes del portal que falten (necesitan cuil
   en `sth_usuarios`) + sus accesos desde la pantalla de Admin.
2. Convivencia corta de validación (el portal ya sin escrituras nuevas).
3. Redirect de `certificaciones.serytec.com.ar` → módulo de Horas.
4. Apagar el Docker, retirar `HORAS_JWT_SECRET` y limpiar el nginx del portal.
5. Archivar el repo del portal (queda como referencia histórica).

## 6. Los tres repos

Toda etapa que toque el portal se cierra verificando **tres** repos: Horas
Backend, Horas Frontend y PortalCertificaciones_backend (rama mergeada +
deployada en cada uno). Incidente de referencia: cierre de etapa 1, donde la
rama del portal quedó sin mergear y produjo 401 en producción.

## 7. Testing y flujo

- TDD en todo lo nuevo; paridad numérica contra el portal en etapas 2 y 4.
- Gráficos con Recharts (carga diferida), tablas sin scroll horizontal.
- Deploy solo con pedido explícito; aviso antes de cada `pm2 restart`.
- Documentación por sesión: contexto de Horas (`.claude/Contexto/`) y
  `CONTEXTO_SISTEMA.md` del portal mientras exista.

## 8. Fuera de alcance

- Baseline completo de Prisma Migrate sobre la BD compartida (camino
  documentado en `prisma/migrations/README.md`, se encara aparte si se
  decide).
- Cambios funcionales al proceso de certificaciones (la migración replica lo
  que hay; mejoras se piden como features aparte).
- Los respaldos Render/Netlify del portal: mueren junto con el portal en la
  etapa 5.
