# Rediseño Panel de Liquidación — Plan de Implementación

> **For agentic workers:** ejecutar task por task con subagentes (implementer + review). Decisiones de diseño cerradas en grilling 2026-08-04 con el dueño del producto.

**Goal:** reemplazar la pantalla única de `/liquidacion/quincena` por: panel de quincenas con estado derivado → página de detalle por quincena (tabla por empleado con chips de alerta) → expand por empleado (detalle diario aprobado + novedades). El motor de cálculo NO cambia.

**Decisiones cerradas (no reabrir):** dos niveles (resumen por empleado = lo que se paga; drill-down diario = trazabilidad) · 3 estados derivados SIN marca manual de "liquidada" · detalle diario SOLO registros aprobados · chips por fila reemplazan el bloque de alertas · filas grises al final para empleados con horas aprobadas sin perfil/perfil incompleto · categoría visible en la fila · novedades del período visibles en el expand con su efecto · importe diario = horas × tarifa, etiquetado "estimado".

## Global Constraints

- Roles: todos los endpoints nuevos `@Roles('Admin','Liquidador')` (patrón del controller existente).
- El cálculo por empleado reusa `CalculoService.calcularQuincena` — NO duplicar fórmulas.
- Quincena: 1 = días 1-15, 2 = 16-fin (usar `src/common/quincena.ts`).
- UI en español; patrones visuales del repo (chips/badges como los de aprobaciones/control general).
- Fix incluido: mensualizado ya no expone el centinela `horasTotal=horasCct=1` — esas columnas van `null` para mensualizado y el front muestra "—".

---

## Task 1 (Backend): endpoints de panel y detalle

**Files:** modify `src/liquidacion/liquidacion.controller.ts`, `src/liquidacion/calculo.service.ts`; create `src/liquidacion/panel.service.ts` + `src/liquidacion/panel.service.spec.ts`.

### `GET /liquidacion/quincenas`

Lista desde la quincena del primer `RegistroHoras` hasta la actual (desc, máx 24). Por quincena:

```ts
{ anio: number; mes: number; quincena: 1|2;
  estado: 'con_pendientes' | 'con_alertas' | 'lista';
  pendientes: number;        // registros estado='pendiente' en el rango
  alertas: number; }         // sinPerfil + perfilIncompleto + datoFaltante (reusar lógica de getAlertasQuincena + datoFaltante del cálculo)
```

`estado`: `con_pendientes` si pendientes>0; sino `con_alertas` si alertas>0; sino `lista`. Implementar con queries agregadas (groupBy por rango), NO corriendo el cálculo completo para cada quincena histórica — para `alertas` de quincenas viejas alcanza con sinPerfil/perfilIncompleto (barato); documentar en el código que `datoFaltante` solo se evalúa para la quincena consultada en detalle.

### `GET /liquidacion/quincena/detalle?anio&mes&quincena`

```ts
{ filas: Array<{           // empleados CON perfil (regimen != administrativo)
    cuil: string; nombre: string; regimen: string; categoria: string | null;
    // números del cálculo existente (reusar calcularQuincena):
    horasTotal: string | null; horasCct: string | null;  // null para mensualizado (fix centinela)
    basico: string; montoExtra: string; presentismo: string; totalPlus: string;
    noRemunerativo: string; total: string;
    provincia?: never;      // provincia/modalidad/etiqueta van en el expand:
    modalidadPago: string | null; etiquetaNovedades: string; datoFaltante: string | null;
    // chips:
    pendientesAprobacion: number;              // registros 'pendiente' del cuil en el rango
    duplicadoCruzado: boolean;                 // mismo cuil+fecha en >1 lote (regla Control general)
    // expand:
    dias: Array<{ fecha: string; contratoCodigo: string; tareas: string[];
                  horas: string; cargadoPor: string; importeEstimado: string | null }>; // solo aprobados; importe = horas × tarifaVigente de su categoría (null si sin categoría/tarifa)
    novedades: Array<{ tipo: string; desde: string; hasta: string; efecto: string }>;
    // efecto: 'pierde presentismo' (Ausencia desaprobada) | 'pierde presentismo (suspensión)' | 'plus $X (N días)' | 'informativa'
  }>;
  sinPerfil: Array<{ cuil: string; nombre: string; horasAprobadas: string; motivo: 'sin_perfil' | 'perfil_incompleto' }>; // filas grises
}
```

`sinPerfil`: empleados activos con registros aprobados en el rango y sin `PerfilLiquidacion`; `perfil_incompleto` = con perfil pero que el cálculo marca `datoFaltante` de categoría/tarifa (mantener también su fila calculada — el gris es solo para los sin perfil; los incompletos van en `filas` con su chip vía `datoFaltante`).

**Tests (panel.service.spec.ts, prisma mockeado, patrón registros-horas.service.spec.ts):** estados derivados (pendientes>0 → con_pendientes; alertas>0 → con_alertas; limpio → lista) · detalle: fila con días solo aprobados e importe estimado · mensualizado con horasTotal null · sinPerfil detecta empleado con horas y sin perfil · novedad Ausencia desaprobada produce efecto 'pierde presentismo'.

**Verificación:** `npm test` + `npx tsc --noEmit` + `npm run build`. Commit: "feat(liquidacion): endpoints de panel de quincenas y detalle con drill-down".

---

## Task 2 (Frontend): panel + detalle + expand

**Files:** rewrite `src/app/(protected)/liquidacion/quincena/page.tsx` (→ panel), create `src/app/(protected)/liquidacion/quincena/detalle/page.tsx` (query params anio/mes/q; App Router: usar searchParams — mantener client component con useSearchParams como aprobaciones), create `src/features/liquidacion/fila-empleado.tsx` + `detalle-empleado.tsx`; modify `src/lib/api/liquidacion.ts` (hooks `useQuincenas`, `useDetalleQuincena` + tipos del contrato de Task 1); tests espejo de los existentes.

- **Panel:** tabla Quincena · Estado (chip 🔴 Con pendientes "N sin aprobar" / 🟡 Con alertas "N" / 🟢 Lista) · botón "Ver detalle" → `/liquidacion/quincena/detalle?anio=&mes=&q=`. La edición de montos mensualizados y km se MUEVE al detalle (fila inline); el panel no edita nada.
- **Detalle:** tabla Empleado · Régimen · Categoría · Hs (— si null) · Básico · Extras · Presentismo · Plus · Bono · TOTAL · chips (pendientes N / duplicado / falta dato). Fila clickeable → expand con: días (Fecha · Contrato · Tareas · Horas · Cargado por · Importe estimado~) + novedades con efecto + provincia/modalidad/etiqueta NOVEDADES. Inline edit de monto mensualizado / km en la fila (reusar hooks useCargarMontosMensualizados/useCargarKmPorTantos existentes, invalidando el detalle). Filas grises al final (sinPerfil) con link a /liquidacion/perfiles.
- Actualizar `liquidacion-nav.ts` si el label cambia ("Quincenas").
- **Tests:** panel renderiza estados y navega · detalle: fila con chips, expand muestra días y novedades, gris sin perfil con link, edit inline de monto invalida y recarga. Adaptar/retirar los tests viejos de quincena-page que ya no apliquen.

**Verificación:** `npx vitest run src/app src/features/liquidacion src/lib` (foreground, timeout 300000) + `npx tsc --noEmit` + `npm run build`. Commit: "feat(liquidacion): panel de quincenas con estados y detalle con drill-down por empleado".

---

## Task 3: glosario + verificación integral

- `docs/glosario.md`: definir **Estado de quincena (panel Liquidador)**: `Con pendientes` / `Con alertas` / `Lista para liquidar` — derivados, sin cierre manual (decisión 2026-08-04); nota del importe diario "estimado" (hs × tarifa; los conceptos quincenales no se prorratean por día).
- Suites completas ambos repos + tsc + build. Contexto §47 al cerrar.
