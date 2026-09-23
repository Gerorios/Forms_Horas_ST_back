# Token de sesión a prueba de localStorage bloqueado — plan (carril corto)

**Pedido:** pendiente de §96. `src/lib/api/token.ts` (Frontend) usa
`localStorage` sin protección: con el almacenamiento bloqueado (modo privado
estricto, cookies de sitio bloqueadas, cuota llena) `setToken` tira dentro de
`signIn` → el login falla, y `getToken` en el effect de `session.tsx` deja una
promesa rechazada sin manejar.

**Decisión (a confirmar):** si el storage falla, el token se guarda **en
memoria** (variable de módulo). La sesión funciona en esa pestaña y se pierde
al recargar. Alternativa descartada: tragar el error sin respaldo → el login
"pasa" pero la siguiente llamada sale sin Bearer → 401 → vuelve a /login.

**Archivos:** `src/lib/api/token.ts` (único de código). Test en
`src/lib/api/token.test.ts` (nuevo).

**Tests rojos primero** (mock de `Storage.prototype` que tira):
1. `setToken` con `setItem` que tira no lanza, y `getToken` devuelve el token.
2. `getToken` con `getItem` que tira no lanza (devuelve el de memoria o null).
3. `clearToken` con `removeItem` que tira no lanza y `getToken` da null.

**Verificación:** spec de `token` + `client.test.ts`, `tsc --noEmit`, eslint
del archivo, suite completa una vez, build.

## Revisión (1 ronda): 1 urgent arreglado, 3 minor sin tocar, 2 descartados

**Paso R1 (urgent):** con cuota llena `setItem` tira pero `getItem` anda; el
catch guardaba el token nuevo en memoria y dejaba el VIEJO persistido. Escenario:
A cierra sin logout, B se loguea en `/login` (no redirige al que ya tiene
sesión), recarga → `getToken()` devuelve el token de A → B opera como A.
Arreglo: `removeItem` protegido en el catch de `setToken`. Test
"con cuota llena, un login nuevo no deja vivo el token anterior tras recargar"
visto fallar (`expected 'tok-A' not to be 'tok-A'`) y después verde.

**Minor sin tocar:** sin test de regresión para `respaldo = null` tras un
`setItem` exitoso; `respaldo` podría llamarse `tokenEnMemoria`; guard +
try/catch repetido 3 veces (extraerlo no vale la pena).

**Deuda previa:** `src/app/login/page.tsx` no redirige a quien ya tiene sesión.
