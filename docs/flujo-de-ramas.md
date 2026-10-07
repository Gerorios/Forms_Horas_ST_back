# Flujo de ramas — Central SER&TEC

Vigente desde el 2026-10-07. Aplica a los dos repos (`Forms_Horas_ST_back` y `Forms_Horas_ST_Frontend`), que se
mueven juntos.

## Las ramas

```
main   ← PRODUCCIÓN. Solo llega lo probado. El deploy sale siempre de acá.
 │
 ├── dev   ← INTEGRACIÓN. Acá se junta todo lo terminado y se prueba en local contra `testing`.
 │    ├── feat/<tema>    funcionalidad o etapa nueva      → PR a dev
 │    ├── fix/<tema>     arreglo que puede esperar        → PR a dev
 │    └── docs/<tema>    solo documentación               → PR a dev
 │
 └── hotfix/<tema>   ← solo urgencias que hoy dañan producción → PR a main, y después se trae a dev
```

## El día a día

1. **Arrancar algo nuevo:** rama desde `dev` actualizada.
   `git fetch` → `git switch -c feat/<tema> origin/dev`
2. **Terminar:** se muestra el cambio, se espera el OK, PR **contra `dev`** y merge con
   `gh pr merge N --merge --admin`.
3. **Probar:** `dev` se levanta en local (Backend contra `testing`, nunca contra `Horas_Sertec`).
4. **Pasar a producción (release):** cuando lo que está en `dev` está probado y aprobado, PR **`dev` → `main`**,
   merge con `--admin` y deploy **solo con "deployá"** explícito. Los dos repos juntos si hay cambio de API.

## Urgencias (hotfix)

Solo para algo que **hoy** daña datos o bloquea el trabajo en producción.

1. Rama desde `main`: `git switch -c hotfix/<tema> origin/main`.
2. Test que falla primero, arreglo, revisión, mostrar, OK.
3. PR **contra `main`**, merge, deploy si se pide.
4. **Traerlo a `dev`** enseguida: merge de `main` en `dev` (o PR `main` → `dev`), así no se pierde ni vuelve.

## Reglas

- Nadie trabaja directo sobre `main` ni sobre `dev`: todo entra por PR.
- **Mientras dure el rediseño ERP**, en `main` solo entran hotfixes del Frontend. Las funciones nuevas del Frontend
  se hacen en `dev` (dentro del rediseño) o esperan. El Backend sigue normal, siempre por `dev`.
- **DDL:** se aplica en `testing` cuando el cambio entra a `dev`, y en `Horas_Sertec` recién en el release a
  `main`, **antes** del deploy del backend, con backup y rollback escritos (ver `docs/sql/`).
- Al empezar cada trabajo, si `main` avanzó por un hotfix, traerlo a `dev` primero.
- Las ramas se borran después del merge (`--delete-branch`).

## Dónde se escribe qué

- Plan del trabajo: `docs/superpowers/plans/AAAA-MM-DD-<tema>.md`.
- Lo vivo (en curso, próximo paso): `.claude/Contexto/estado.md`.
- Lo entregado: la bitácora `.claude/Contexto/contexto-proyecto.md`, al hacer el merge a `dev` (y una nota más
  cuando llega a producción).
- Deploy: `docs/AAAA-MM-DD-<tema>-deploy.md`.
