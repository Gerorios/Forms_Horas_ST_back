# Higiene de los dos repos (2026-09-28)

**Carril corto.** Cero archivos de código, sin DDL, sin API. Solo docs, `.gitignore` y git.

**Pedido:** borrar las ramas locales ya mergeadas en Backend y Frontend, y atender las
observaciones de higiene del relevamiento.

## Pasos

1. **Ramas locales mergeadas** en los dos repos: `git branch --merged main` sin `main`,
   `git branch -d` (sin `-D`: si alguna no está mergeada, git la frena). Las remotas no se
   tocan.
2. **Backend `.gitignore`**: agregar `skills-lock.json` (lock de `.claude/skills/`, que ya
   está ignorada).
3. **Backend `docs/sql/2026-08-21-detalle-diario-consulta.sql`**: ~~se commitea~~ **NO se
   commitea** (decisión del usuario al aprobar el plan: no quiere esa consulta en GitHub).
   Va a `.git/info/exclude`, que es local y no viaja al remoto, para que `git status`
   quede limpio.
4. **Bitácora §2 y §8**: reemplazar el stack/hosting viejo (Vercel/Render, base `testing`)
   por el real (VPS Hostinger, pm2, Nginx, base `Horas_Sertec` + `testing`, ver §33 y §39)
   y marcar los pendientes de seed de §8 como resueltos, con nota de fecha. No se borra
   texto histórico: se tacha o se anota como superado, como se hizo en §3.
5. **Frontend `README.md`**: reemplazar la plantilla de create-next-app por un README
   corto del proyecto: qué es, cómo levantar (`.env.local`, `npm run dev`), tests, dónde vive
   la documentación (Backend).
6. Cierre: sección §99 en la bitácora (10 líneas).

## Verificación

`git branch` limpio en los dos repos; `git status` sin archivos sin trackear en Backend;
lectura de los docs editados. Sin tests (solo docs).

## Riesgos / hallazgo

- `docs/infraestructura-produccion.md` **no existe en disco** aunque §33 dice que se creó
  (gitignored). No se recrea acá: hay que ver si quedó en otra máquina o en un backup.
- PRs: uno por repo (`chore/higiene-repos`).
