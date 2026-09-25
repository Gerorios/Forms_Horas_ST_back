# /login redirige a quien ya tiene sesión (Frontend) — carril corto

## Context
Pendiente de §97: `src/app/login/page.tsx` no mira la sesión, así que con un token
vigente se puede entrar a /login y loguearse encima (B pisa a A sin logout).
`useSession()` ya expone `perfil` y `loading` (`src/lib/auth/session.tsx`), y el
patrón de redirección existe en `app-shell.tsx` (`router.replace('/login')`).

## Plan (1 archivo de código + su test)
1. Worktree del Frontend desde `origin/main` (`55b3ded`), rama `fix/login-con-sesion`,
   junction de `node_modules`. (El checkout local está en la rama vieja
   `feat/horas-extra-pactadas`: no se toca.) Copiar este plan a
   `docs/superpowers/plans/2026-09-25-login-con-sesion.md` del Backend (PR de docs).
2. **Test rojo** en `src/app/login/login-page.test.tsx`:
   - con `perfil` y `loading: false` → `router.replace('/')` y el formulario no se ve;
   - con `loading: true` → no redirige y no muestra el formulario (sin parpadeo);
   - sin perfil → formulario como hoy (los 6 tests existentes siguen verdes;
     el mock de `useRouter` suma `replace`).
3. **Implementación** en `page.tsx`: tomar `perfil, loading` de `useSession()`;
   `useEffect` → si `!loading && perfil` hace `router.replace('/')` (replace, no
   push: /login no queda en el historial); render `null` mientras `loading || perfil`.
4. Verificación: spec de login, `tsc`, eslint del archivo, suite completa 1 vez,
   `next build`; probar en local (`next dev --webpack`): logueado → /login rebota
   a /; sin sesión → formulario.
5. Revisión: `code-review` (1 agente, 2 ejes) → `verificador-review`; urgent/high
   se arreglan, minor se listan. Después mostrar → OK → PR → merge. Deploy solo
   si lo pedís.

## Desvío en la ejecución
Se quitó `router.push('/')` de `onSubmit`: con el effect nuevo, un login exitoso
navegaba dos veces (push + replace). Ahora navega solo el effect, con `replace`.
El test del login exitoso verifica 1 `replace` y 0 `push`. El mock de `useRouter`
pasó a instancia estable (como el router real) para no re-disparar el effect.

## Resultado
Rojo visto (2 tests), spec 9/9, suite 845/845, tsc/eslint limpios, next build OK.
Revisión: 0 urgent, 0 high, 4 minor sin tocar, 2 descartados. Deuda previa:
`session.tsx` deja el token nuevo si `fetchPerfil` falla tras un login OK.

## Decisión tomada (cambiala si no te va)
Mientras la sesión carga, /login no muestra nada en vez de mostrar el formulario
y rebotar enseguida. Sin token, `loading` pasa a false en el primer effect, así
que el que no está logueado casi no nota la diferencia.
