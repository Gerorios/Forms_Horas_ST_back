# Horas extra pactadas (unifica `fijo`/`fijo_105`) + baja de `modalidadPago`

Fecha: 2026-09-11 · Repos: **Backend** y **Frontend** · **DDL en las dos bases**

## 1. Qué se pide

Que el régimen `fijo` deje de tener las horas extra hardcodeadas (0 en `fijo`,
17,5 en `fijo_105`) y las lea de un campo por empleado, `horasExtraPactadas`,
para cubrir a MACCHIAROLA (88 + 12) sin crear un régimen por cada arreglo.
`fijo_105` desaparece del enum y sus 11 perfiles migran a `fijo` + 17,5. En el
mismo trabajo se elimina `modalidadPago`, dejando el `DROP COLUMN` para un
segundo paso posterior al deploy. Las 88 hs del CCT y las filas congeladas de
los cierres no se tocan.

## 2. Decisiones cerradas en la entrevista

| Decisión | Resuelto |
|---|---|
| Qué varía | **Solo las horas extra.** Las 88 de base son del CCT y no se tocan |
| Qué se guarda | **Horas, no monto.** Si UOCRA aumenta, la persona cobra más y el recibo dice las mismas horas |
| Dónde vive | **Campo en `PerfilLiquidacion`**, no un catálogo reutilizable |
| El enum | `fijo_105` **desaparece**; los 11 migran por UPDATE a `fijo` + 17,5 |
| Historial | **Se pisa.** El cierre (ADR-021) congela cada quincena, así que lo cerrado no se mueve |
| Valores | Decimales (17,5) y **0 permitido** (= el viejo `fijo` de 88 puro) |
| Sin cargar | `datoFaltante`, nunca un 0 silencioso |
| Lo reportado | **No influye**: 12 pactadas son 12 aunque haya cargado 200 |
| Vocabulario | **Horas extra pactadas** — "pactadas" por el arreglo con RRHH |
| Modalidad | Se elimina de los dos repos; los cierres congelados la conservan; `DROP` en un 2º paso |

## 3. Datos duros relevados (base `testing`)

- Perfiles: **77 jornalizado, 14 administrativo, 12 mensualizado, 11 fijo_105,
  5 por_tantos, 0 `fijo`**.
- Los **11 `fijo_105` son todos categoría "Ayudante"** — política de grupo.
- `modalidad_pago`: **105 `con_descuentos`, 1 `en_b`, 13 null**.
- **11 filas congeladas** en `sth_cierre_liquidacion_detalle` con `fijo_105`.
- **1 perfil** con `permiteHorasExtra = 1` (mensualizado) — relevante por el bug
  latente del punto 5.

## 4. Hallazgos que matizan lo cerrado

1. **`fijo_105` no puede desaparecer del todo como literal.**
   `export-cierre.service.ts:16` mapea el `regimen` **congelado** al TIPO del
   Excel. Hay 11 filas históricas con ese valor: si se borra la clave, exportar
   un cierre viejo imprime `fijo_105` crudo. **Se conserva solo ahí**, con
   comentario "histórico", y su test se mantiene. *Verificado leyendo el
   archivo.*
2. **Bug latente ya en producción.** `perfiles/page.tsx` re-manda el perfil al
   guardar contratos de imputación, pero **no manda `permiteHorasExtra`**, y el
   backend hace `permiteHorasExtra: dto.permiteHorasExtra ?? false`. Hoy eso
   apaga el flag del único mensualizado que lo tiene. Si el campo nuevo se
   implementa igual, guardar contratos le borraría las horas pactadas.
   *Verificado en los dos archivos.*
3. **La alerta "perfil incompleto" baja de conteo** al sacar modalidad (13
   perfiles la tienen null). Es esperado, pero se ve en el panel.
4. **ADR-020 rechazó explícitamente esta solución** ("reusar `fijo` con un
   flag… se descartó a favor de un régimen nuevo"). El ADR nuevo tiene que
   decir por qué se revierte: apareció el tercer caso, que rompe el supuesto de
   "un nombre por régimen".
5. **Producción puede tener perfiles `fijo`** (en `testing` hay 0). Se migran a
   `0`, que conserva exactamente su comportamiento actual.
6. El glosario viejo (`docs/glosario.md`) tiene entradas de modalidad que
   quedarían contradictorias: se corrigen.

## 5. Corte en PRs

- **PR-1 (Backend + Frontend, juntos, los dos temas, commits separados).** Los
  dos temas editan **las mismas líneas** (`calculo.service.ts`, el DTO,
  `schema.prisma`, `perfiles/page.tsx`); separarlos obliga a esperar merge y
  deploy del primero o a pelear conflictos. El tema 2 es borrado puro sin
  efecto en montos.
- **PR-2 (Backend, después):** solo el `DROP COLUMN modalidad_pago`, cuando el
  usuario haya verificado producción. Es el único paso irreversible.

## 6. Pasos

### Etapa 0 — DDL paso 1 y ensayo en `testing` (ANTES del PR)

`docs/sql/2026-09-11-perfiles-horas-extra-pactadas.sql`, en este orden:

1. `ADD COLUMN horas_extra_pactadas DECIMAL(5,2) NULL`
2. `UPDATE … SET horas_extra_pactadas = 0 WHERE regimen='fijo'`
3. `UPDATE … SET regimen='fijo', horas_extra_pactadas=17.50 WHERE regimen='fijo_105'`
4. **Guarda**: `COUNT(*) WHERE regimen='fijo_105'` debe dar **0** antes de seguir
5. `MODIFY COLUMN regimen ENUM(...)` sin `fijo_105`

**Por qué ese orden es obligatorio:** el enum nuevo de Prisma no conoce
`fijo_105`; una sola fila con ese valor tira abajo perfiles, panel, alertas,
análisis y cierres al deserializar. Y sin el `ADD COLUMN`, todo `findMany`
pide una columna que no existe.

**Cuidado con el ENUM:** achicarlo no es como ampliarlo. Si queda una fila con
el valor removido, en modo estricto el `ALTER` falla (1265) y en modo no
estricto **la deja en `''` en silencio**. De ahí la guarda del punto 4 y el
`SELECT @@sql_mode` en la precondición.

**Rollback:** volver el enum y `UPDATE … WHERE cuil IN (<lista guardada>)`.
Usar la **lista de CUILs**, no `WHERE horas_extra_pactadas=17.5`: después del
deploy, un `fijo` con 17,5 puede ser una asignación nueva.

**Verificación:** ensayar en `testing`, correr el rollback, y volver a aplicar.

### Etapa 1 — Backend

1. **Tests primero** en `calculo.service.spec.ts`: `fijo` con 0 → 88/88/0;
   con 17,5 → **105/88/17,5 y los mismos montos que hoy** (prueba de que los 11
   cobran igual); con 12 y **200 hs declaradas** → 100/88/12 (MACCHIAROLA); con
   null → `datoFaltante`; sin categoría → el faltante de categoría; y un test
   de alertas que hoy falla y prueba la baja de modalidad.
2. **`schema.prisma`**: sacar `fijo_105` y `ModalidadPago`, agregar
   `horasExtraPactadas Decimal? @db.Decimal(5,2)`. `CierreLiquidacionDetalle`
   **no se toca**. El build roto después de esto es el inventario automático de
   lo que falta.
3. **`calculo.service.ts`**: fusionar las ramas `fijo`/`fijo_105` en una sola.
4. **DTO, servicio, panel, análisis, cierres**; `export-cierre` **se conserva**.
5. **Prueba manual contra `testing`** ya migrada.
6. **Docs**: ADR-023, ADR-020 → "Superado", `CONTEXT.md`, `docs/glosario.md`,
   §87 del contexto.

### Etapa 2 — Frontend

0. **Mockup primero** (regla del usuario). El `select` de modalidad se va; en
   su lugar, solo con régimen Fijo, un input de horas extra pactadas. La
   columna "Modalidad de pago" pasa a "Hs extra pactadas".
1. Tests primero en `perfiles-page.test.tsx`, incluido **"guardar contratos
   re-manda las horas pactadas"** (el bug del punto 4.2).
2. `lib/api/liquidacion.ts`, `perfiles/page.tsx`, `fila-empleado.tsx`,
   `detalle-empleado.tsx` y fixtures.

### Etapa 3 — Mostrar → PRs → merge → deploy

Deploy en este orden y no otro:
1. **Foto previa** del panel en vivo para los 11 y del conteo de alertas.
2. `git pull` en los dos repos (el código viejo sigue corriendo desde `dist`).
3. **Backup JSON** de `sth_perfiles_liquidacion` (con `modalidad_pago`: es el
   único respaldo de ese dato) + lista de CUILs `fijo_105` de producción.
4. **DDL paso 1** en `Horas_Sertec`.
5. Build y `pm2 restart` de ambos.
6. **Verificación**: las 11 filas **idénticas a la foto**; alertas bajaron solo
   lo esperado; Excel de un cierre viejo con `fijo_105` sigue saliendo bien.
7. El usuario carga a MACCHIAROLA y ve 100/88/12.

**Ventana de riesgo (4→5):** entre el DDL y el restart, el código viejo ve a
los 11 como `fijo` 88 puro en el panel en vivo. **No cerrar quincenas durante
el deploy.**

### Etapa 4 — `DROP COLUMN modalidad_pago` (PR-2)

Solo después de verificar producción. Rollback ya no gratis: `ADD COLUMN` +
repoblar desde el JSON del paso 3.3.

## 7. Riesgos (de mayor a menor)

1. **DDL con migración de datos en base compartida.** Si queda una fila
   `fijo_105` y el modo no es estricto, el `MODIFY` la deja en `''` en silencio
   y esa persona desaparece del cálculo. → guarda con aborto, backup, rollback
   ensayado.
2. **Que los 11 cobren distinto.** → el test migrado exige los mismos números;
   comparación fila por fila contra la foto previa.
3. **Ventana entre DDL y restart.** → deploy fuera de horario, no cerrar
   quincenas.
4. **Orden invertido = caída total del módulo de liquidación** (no un endpoint:
   perfiles, panel, alertas, análisis y cierres).
5. **Pérdida deliberada de `modalidad_pago`** (105 + 1). Irreversible tras el
   paso 2 → el backup JSON es el único respaldo.
6. **Cambios visibles no pedidos pero inevitables**: la alerta de perfiles
   incompletos baja, y la columna NOVEDADES del Excel pierde la etiqueta de
   modalidad en cierres nuevos. **El Excel lo consume gente externa.**
7. Cierres históricos con `fijo_105` → clave conservada en el Excel.
8. El bug de contratos de imputación (punto 4.2).
9. `fijo` preexistentes en producción → el script los pone en 0.
10. Desfase front/back durante el deploy.
11. `Decimal` llega como string al Frontend → `Number()` explícito.

## 8. Fuera de alcance

Las 88 hs y el ×1,5 (no se configuran); catálogo de regímenes; versionado del
campo; guardar el monto pactado; `CierreLiquidacionDetalle`; recalcular cierres
existentes; los demás regímenes; los pendientes de seguridad.
