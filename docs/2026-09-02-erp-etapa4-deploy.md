# Deploy — ERP Etapa 4 (carga de certificaciones desde misregistros)

Nota de deploy de la Etapa 4 (upload + parser + validación + escritura de
certificaciones, ver `.superpowers/sdd/2026-09-02-erp-etapa4-carga/`).

## Smoke de paridad (Task 8, hecho antes del deploy)

Se corrió el parser TS (`src/certificaciones/carga/parser-excel.ts`,
`parsearExcel`) y el parser Python del portal
(`PortalCertificaciones_backend/app/services/parser.py`, `parsear_bytes`)
sobre el MISMO archivo `.xlsx`: no había ningún Excel real de Naturgy ni
fixture `.xlsx` en el árbol del portal (`tests/` solo genera libros
in-memory con `openpyxl` en `test_parser_excel.py`), así que se generó un
fixture representativo con `exceljs` — hoja `CERTIF K8 NORTE`, meta
`TOTAL MES` en es-AR, 6 filas de datos (una con código con coma
`432,1`, montos es-AR con miles y decimales, una fila con cantidad 0,
una fila de plantilla = header `ÍTEMS...` repetido en medio del cuerpo, y
una fila de subtotal `TOTAL:`).

**Resultado: paridad exacta.** Mismas 6 filas, mismo `total_declarado`
(39072433.92), mismo único error (`Cantidad es 0.`, fila 9, campo
`cantidades`), mismos valores campo a campo (item_codigo, contrato,
región, provincia titulada, tarea con tildes, montos normalizados
es-AR). Única diferencia: el TS agrega el campo `fila_excel` (fix B4,
documentado en el parser) que Python no emite — no es una discrepancia
de datos, es un campo agregado a propósito. El detalle completo (ambas
salidas literales) está en
`.superpowers/sdd/2026-09-02-erp-etapa4-carga/task-8-report.md`.

**Lo que este smoke NO cubre:** un Excel real de Naturgy (con sus
particularidades reales de formato/columnas que el fixture sintético no
puede anticipar del todo). Por eso el paso 5 de este checklist incluye
la paridad manual con un archivo real como parte del deploy.

## Checklist de deploy

1. **Merge PRs (TRES repos)**: Backend, Frontend y Portal.
   - Portal (`PortalCertificaciones_backend`): **sin cambios** — verificado
     el 2026-09-02, rama `main`, `git status` solo muestra `.claude/` y
     `skills-lock.json` sin trackear (nada de código). No hay PR que
     mergear en el portal para esta etapa.
   - Backend y Frontend: mergear `feat/erp-etapa4-carga` (y su rama
     equivalente en Frontend) a `main` antes de deployar.

2. **DDL B7 en las DOS bases**: correr a mano
   `docs/sql/2026-09-02-cargas-log-contrato.sql`
   (`ALTER TABLE sth_cert_cargas_log MODIFY contrato VARCHAR(60) NULL;`)
   tanto en `testing` como en `Horas_Sertec` (producción — ver memoria
   "BD producción = Horas_Sertec"). NO se ejecuta automáticamente vía
   migración.

3. **VPS**: `git pull` en Backend y Frontend, `npm install` en ambos
   (¡`pdfjs-dist ^6.3.289` es dependencia NUEVA del Backend — confirmado
   en `package.json`, junto con `exceljs ^4.4.0`!), `npx prisma generate`,
   `npm run build` en ambos.

4. **Aviso + reinicio**: avisar a los usuarios activos antes del corte,
   luego `pm2 restart` (Backend, 1 worker — ver memoria "PortalCertificaciones
   en el VPS" para el patrón de reinicio de este tipo de apps).

5. **Smoke post-deploy**:
   - `POST /certificaciones/carga/preview` sin token → 401.
   - `POST /certificaciones/carga/preview` con usuario de nivel lectura
     (sin nivel admin/carga) → 403 (la autorización vive en
     `CargaService`, no en un `@Roles` del controller — confirmado en
     `certificaciones.controller.ts`).
   - **PARIDAD con archivo real (paso manual, no cubierto por el smoke
     sintético de Task 8)**: tomar el mismo Excel real de Naturgy y
     cargarlo en preview tanto en misregistros como en el portal viejo;
     confirmar mismas filas, mismos errores y mismo total declarado.
   - Carga de prueba chica en misregistros + su deshacer (`DELETE
     /certificaciones/carga/:logId`), para validar el circuito completo
     incluyendo `sth_cert_cargas_log`.

6. **Aviso operativo**: la carga de certificaciones se hace desde
   misregistros a partir de ahora. `upload.html` del portal queda
   redundante — **no cargar el mismo archivo por los dos lados**. La
   regla de duplicado exacto por `archivo_nombre` protege contra una
   doble carga accidental, pero igual hay que avisar al equipo para que
   no lo intenten a propósito ni por costumbre.

7. **Documentar en los dos contextos**: `CONTEXTO_SISTEMA.md` /
   `CONTEXT.md` de misregistros y del portal (ver memoria "Flujo de
   trabajo del Portal"). Commit.
