# Frontend Fase 2 — Reporte diario + Mis registros (Design)

**Fecha:** 2026-07-03
**Proyecto:** App de Registro de Horas (ver `Backend/.claude/Contexto/contexto-proyecto.md`)
**Alcance:** Fase 2 — las dos pantallas del Operario: **Reporte diario** (la carga central, ex "carga masiva") y **Mis registros** (historial propio). Más una adición chica de backend (catálogos de solo lectura).

> Nomenclatura: la pantalla de carga se llama **"Reporte diario"** (ruta `/reporte`). Internamente sigue produciendo N×M filas vía `POST /registros-horas/batch`.

---

## 1. Objetivo

Que un Operario pueda **reportar el trabajo del día** (N operarios × M líneas `{contrato, tarea, horas}` con provincia, GPS y móviles compartidos) en una sola pantalla, y **consultar su propio historial** filtrado por quincena. El backend `/batch` ya existe (Fase B); falta habilitar la lectura de catálogos para roles no-Admin y construir ambas pantallas.

## 2. Adición de backend: módulo `catalogos` (solo lectura)

**Problema:** los GET de tareas, provincias y móviles viven hoy en `AdminController` con `@Roles('Admin')`. El Operario no puede leerlos, pero los necesita para el reporte.

**Solución:** nuevo `CatalogosModule` con `CatalogosController` protegido solo por `JwtAuthGuard` (cualquier usuario autenticado):

- `GET /catalogos/tareas?contratoId=N` → tareas **activas** del contrato (`activo=true`), ordenadas por nombre. `contratoId` obligatorio.
- `GET /catalogos/provincias` → todas las provincias, ordenadas por nombre.
- `GET /catalogos/moviles` → móviles **activos**, ordenados por identificador.

`CatalogosService` consulta Prisma directamente (mismas queries que ya usa `AdminService`, filtrando `activo` donde corresponde). No se toca `AdminController` (sigue con su ABM Admin-only).

## 3. Frontend — dependencias

Inicializar **shadcn/ui** (diferido de Fase 1). Componentes a agregar: `button`, `input`, `label`, `select`, `command` + `popover` (para combobox/multiselect), `dialog`, `table`, `badge`, `sonner` (toast), `calendar` + `popover` (date picker). shadcn con Tailwind v4 escribe sus tokens en `globals.css`; se conservan los tokens de marca (`brand`/`neutral`/`alert`) ya definidos.

## 4. Frontend — Reporte diario (`/reporte`)

Formulario único (React Hook Form + Zod), mobile-first. Secciones:

**4.1 Compartido por todo el reporte**
- **Fecha**: date picker, permite fechas retroactivas. Default: hoy.
- **Provincia**: select de `GET /catalogos/provincias`. Obligatoria (una sola).
- **Móviles**: multiselect de `GET /catalogos/moviles` (opcional; aplican a todas las filas).
- **GPS**: se captura con `navigator.geolocation` al montar. Estados: capturando / capturado (muestra lat,lng) / denegado. Si se deniega, **igual se puede guardar** (queda sin coordenadas; la provincia es el respaldo).

**4.2 Operarios[]**
- Multiselect con búsqueda: `GET /empleados?q=<texto>` (debounced). La lista son empleados activos. Se pueden elegir varios. Muestra chips de los seleccionados. Mínimo 1.

**4.3 Líneas[]**
- Repetidor. Cada línea: **contrato** (select de los `contratosHabilitados` del perfil de sesión) → **tarea** (select de `GET /catalogos/tareas?contratoId=` del contrato elegido; se deshabilita hasta elegir contrato) → **horas** (número > 0). Botón agregar/quitar línea. Mínimo 1 línea.

**4.4 Envío**
- **Preview en vivo**: "Se generarán **N×M** filas" (N = operarios, M = líneas).
- Botón **Reportar** → **diálogo de confirmación** que resume (fecha, N operarios, M líneas, total filas) → `POST /registros-horas/batch` con el payload `{fecha, provinciaId, gpsLat?, gpsLng?, movilIds?, operarioCuils[], lineas[]}`.
- Éxito → **toast** "Reporte cargado (X filas)" + limpia el formulario (mantiene fecha/provincia para cargas seguidas).
- Error 403 (contrato no habilitado) u otro → toast con el mensaje del backend.

**Validación (Zod):** fecha válida; provinciaId requerido; operarioCuils ≥ 1; lineas ≥ 1; cada línea con contratoId, tareaId y horas > 0.

## 5. Frontend — Mis registros (`/mis-registros`)

- **Fuente:** `GET /registros-horas?operarioCuil=<cuil del perfil de sesión>` — solo las horas donde el usuario logueado es el operario (nunca compañeros, §6.4).
- **Quincena:** selector de mes + 1ª (1–15) / 2ª (16–fin) quincena. El filtrado y el agrupado se hacen **en cliente** (los datos propios son pocos). Default: quincena actual.
- **Tabla:** fecha, contrato (código), tarea, horas, estado (chip de color: pendiente/aprobado/desaprobado), móviles. **Badge de alerta** si `alertaHoras`. Si el estado es `desaprobado`, muestra `motivoDesaprobacion` (tooltip o fila expandible).
- **Total** de horas de la quincena filtrada (suma en cliente).
- Estado vacío claro ("Sin registros en esta quincena").

## 6. Datos y estado

- **TanStack Query** para catálogos (`provincias`, `moviles`, `tareas` por contrato — cacheados por `queryKey`), búsqueda de empleados (query dependiente del texto con debounce) y "mis registros".
- **Mutación** para el batch (`useMutation`), invalidando "mis registros" al éxito.
- Utilidades puras (testeables): cálculo de quincena a partir de una fecha, y el cálculo de filas N×M para el preview.

## 7. Manejo de errores

- Validación de formulario inline (Zod + RHF).
- GPS denegado: no bloquea; se muestra aviso suave y se permite guardar.
- Errores de red / backend: toast con mensaje claro; el 401 ya lo maneja el interceptor (re-login).
- 403 de contrato no habilitado en el batch: toast con el detalle del backend.

## 8. Estructura de archivos (frontend)

```
src/
  app/(protected)/
    reporte/page.tsx            # Reporte diario
    mis-registros/page.tsx      # Historial propio
  features/reporte/             # componentes del form (operarios-select, lineas, moviles-select, gps, confirm-dialog)
  features/mis-registros/       # tabla + selector de quincena
  lib/api/catalogos.ts          # hooks: useProvincias, useMoviles, useTareas(contratoId)
  lib/api/empleados.ts          # useBuscarEmpleados(q)
  lib/api/registros.ts          # useCrearReporteBatch(), useMisRegistros(cuil)
  lib/quincena.ts               # cálculo de quincena (puro)
  components/ui/                # shadcn
```

Backend:
```
src/catalogos/
  catalogos.module.ts
  catalogos.controller.ts
  catalogos.service.ts
```

## 9. Testing

- **Backend:** verificación por integración/curl de los 3 GET de catálogos (accesibles con token de Operario). (El backend sigue sin suite automatizada; se puede sumar Jest más adelante.)
- **Frontend (Vitest + RTL):**
  - `lib/quincena.ts`: unit tests de rangos (1–15, 16–fin, fin de mes variable, año/mes límite).
  - preview N×M: unit test de la función de conteo.
  - Reporte: test de validación (sin operarios / sin líneas / horas 0 no envía) y de envío feliz (llama al batch con el payload correcto y muestra toast).
  - Mis registros: test de que filtra por quincena en cliente y suma el total.

## 10. Nav / navegación

- En `nav.ts`: renombrar el item `{ label: 'Carga masiva', href: '/carga' }` → `{ label: 'Reporte diario', href: '/reporte' }`. "Mis registros" ya existe (`/mis-registros`). Ambos para roles `Operario` y `JefeContrato`.

## 11. Fuera de alcance (Fase 2)

- Bandeja de aprobación del Jefe de Contrato, novedades, ausencias, panel Admin (Fases 3–4).
- Edición/corrección desde "Mis registros" vía `PATCH /registros-horas/:id` (el endpoint existe; la UI de corrección se puede sumar en una iteración posterior de Mis registros).
- Seeds reales de catálogos (contratos K2–K12, tareas, móviles) — dependen de datos de negocio (§8 del contexto).
