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
  `ma_provincias`, `carga_log`) **ya viven en `Horas_Sertec`** (confirmado
  2026-09-01). NO se migran datos: se agregan modelos a `prisma/schema.prisma`
  con `@@map`, sin tocar el DDL existente.
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

ABM de `dim_item` (ítems con ptos_gasnor y contrato asignado) como pantalla
del módulo (solo nivel `admin`), estilo pantallas de Admin de Horas.

### Etapa 4 — Carga de certificaciones

La parte pesada: subir Excel/PDF, parser y validación portados de Python a
Node (exceljs ya está en el backend por liquidación), escritura en
`fact_certificaciones` + `carga_log`. Visibilidad: `carga` solo sobre sus Ks.

- **Tests de paridad obligatorios**: mismos archivos reales de entrada →
  mismas filas resultantes que el parser Python (fixtures tomadas del
  histórico de `carga_log`).
- **Decisión OneDrive (hoy EN PAUSA)** se toma acá: portar la copia de
  respaldo a Node (Graph API + rotar el secreto de Azure pendiente) o
  eliminarla y guardar copia en disco del VPS con backup. Default sugerido:
  disco del VPS, salvo que alguien use activamente la carpeta de OneDrive.

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
