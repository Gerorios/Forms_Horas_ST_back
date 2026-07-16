# Filtro de usuarios + reset de contraseña — Diseño

**Fecha:** 2026-07-15
**Repos afectados:** `Forms_Horas_ST_back` (backend NestJS), `Forms_Horas_ST_Frontend` (frontend Next.js).
**Sesión:** `/grill-with-docs` (grilling + domain-modeling). Ver `docs/adr/2026-07-15-adr-003-password-reset-cuil.md`
y la entrada nueva de `docs/glosario.md` ("Reset de contraseña").

## 1. Contexto y problema

Dos pedidos del dueño del producto sobre `/admin/usuarios`:

1. La lista de usuarios no tiene forma de filtrar — con la app creciendo, encontrar a alguien
   específico para editarlo es lento.
2. Se hizo un alta masiva de usuarios y se perdieron las contraseñas generadas (se cerró la
   pestaña del navegador antes de copiar la tabla de credenciales). Como las contraseñas se
   guardan como hash `bcrypt` (irreversible), **no hay forma de recuperar las originales** — se
   necesita poder resetearlas.

## 2. Feature 1 — Filtro en `/admin/usuarios`

**Alcance:** filtro **client-side**, sobre los datos que ya trae `GET /admin/usuarios` (no hay
cambios de backend para esta parte — la base de usuarios es de 50-200 personas, sin problema de
volumen para filtrar en el navegador).

- **Texto libre por nombre:** matchea contra `usuario.empleado.apellido_nombre`, substring,
  case-insensitive y accent-insensitive (normalizar con `.normalize('NFD').replace(/[̀-ͯ]/g, '')`
  antes de comparar, para que "jose" encuentre "JOSÉ").
- **Selección múltiple de rol:** chips (mismo patrón visual que "contratos habilitados" en
  `UsuarioEditRow`), usando la lista de `useRoles()` ya existente. Ningún chip seleccionado =
  no filtra por rol (todos pasan ese criterio).
- **Combinación:** "Y" — un usuario se muestra si (no hay texto O matchea el texto) Y (no hay
  roles seleccionados O `rolId` ∈ roles seleccionados).
- Filtro reactivo (sin botón "Buscar", se aplica en cada cambio).

**Fuera de alcance:** filtro por email, filtro server-side, paginación (no hace falta con este
volumen).

## 3. Feature 2 — Reset de contraseña individual por Admin

### 3.1 Decisión central (ver ADR-003)

La contraseña de un usuario, tanto en alta masiva como en reset individual, **es su propio CUIL**.
Decisión consciente que acepta un riesgo de seguridad real (el CUIL no es secreto) — documentado
y aprobado explícitamente por el dueño del producto. No hay autoservicio de "olvidé mi
contraseña" en esta iteración (queda diferido — no hay infraestructura de email ni direcciones
enviables para la mayoría de los usuarios de alta masiva, que reciben `<legajo>@st.local`).

### 3.2 Backend

**Nuevo endpoint:** `POST /admin/usuarios/:cuil/resetear-password`

- Guard: hereda `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('Admin')` del controller (igual
  que el resto de `AdminController`).
- Sin DTO de entrada (no recibe body).
- `AdminService.resetearPassword(cuil: string)`:
  ```ts
  async resetearPassword(cuil: string) {
    const passwordHash = await bcrypt.hash(cuil, 10);
    await this.prisma.usuario.update({ where: { cuil }, data: { passwordHash } });
    return { cuil, password: cuil };
  }
  ```
  (10 rounds de salt — confirmado igual al resto de `AdminService`: `admin.service.ts:100,117,154`
  usan `bcrypt.hash(x, 10)` en todos los casos.)
- Respuesta: `{ cuil, password }` — se devuelve por consistencia con el shape de alta masiva,
  aunque el frontend no necesita mostrarlo como "secreto revelado" (ver §3.3).

**Cambio en alta masiva (`AdminService.createUsuariosMasivo`):**
- Reemplazar `const password = this.generarPassword();` por `const password = cuil;`.
- Eliminar el método privado `generarPassword()` (queda sin usos).
- El resto de la lógica (creación del usuario, hash, tabla de credenciales devuelta) no cambia —
  la respuesta sigue teniendo la forma `{ cuil, apellido_nombre, email, password }[]`, solo que
  `password` ahora es igual a `cuil`.

### 3.3 Frontend

**Hook nuevo** en `lib/api/admin.ts`:
```ts
export function useResetearPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cuil: string) =>
      api.post(`/admin/usuarios/${cuil}/resetear-password`, {}).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'usuarios'] }),
  });
}
```

**UI:** botón "Resetear contraseña" dentro del form expandido de `UsuarioEditRow` (junto a los
demás campos editables), con un diálogo de confirmación antes de ejecutar (mismo patrón shadcn
`Dialog` que ya se usa para "Desaprobar" en `/aprobaciones`, sin necesidad de campo de motivo acá,
solo confirmar/cancelar).

- El diálogo indica explícitamente a qué se va a resetear: **"¿Resetear la contraseña de
  {apellido_nombre} a su CUIL ({cuil})?"** — no hace falta pantalla de "contraseña generada" post-reset
  como en el alta masiva, porque el valor es conocido de antemano (ya se ve el CUIL en la fila).
- `toast.promise`: `'Reseteando…'` / `'Contraseña reseteada'` / `'No se pudo resetear'`.
- El botón de reset es independiente del botón "Guardar" del resto del form (no landea en el mismo
  payload de `PATCH /admin/usuarios/:cuil`; dispara su propia mutation al hacer clic).

**No hay cambios necesarios en la UI de alta masiva** — la tabla de credenciales ya muestra el
campo `password` que devuelve el backend tal cual; al cambiar ese valor a `cuil` del lado del
backend, el frontend no necesita tocarse.

## 4. Fuera de alcance (ambas features)

- Autoservicio "olvidé mi contraseña" para el usuario final (diferido, ver ADR-003).
- Cambio de contraseña por el propio usuario logueado (pendiente global preexistente, sin
  backend — no se toca en esta spec).
- Paginación o filtro server-side de usuarios.
- Reset masivo (varios usuarios a la vez) — solo individual, uno por uno.

## 5. Verificación

- Backend: sin test suite automatizada (consistente con el resto del módulo Admin) — verificación
  por `npm run build` + curl manual documentado (mismo patrón que el resto del panel admin).
- Frontend: tests de componente para el filtro (texto + chips de rol, combinación "Y") y para el
  botón de reset en `UsuarioEditRow` (abre diálogo, confirma → llama la mutation con el `cuil`
  correcto, cancela → no llama nada). `npm test`, `npm run lint`, `npm run build`.
- E2E manual por curl/click-through con Admin real, igual que el resto del panel.
