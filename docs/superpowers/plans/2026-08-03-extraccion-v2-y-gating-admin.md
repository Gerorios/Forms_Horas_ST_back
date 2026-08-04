# Extracción v2 + gating Admin-only — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aprovechar los campos nuevos del prompt de extracción (medio de pago sugerido, confianza, línea de origen, coherencia) y restringir temporalmente todo el módulo combustible a Admin.

**Architecture:** El backend valida/deriva en `ExtraccionTicketService.extraer()` (el modelo solo sugiere; las reglas de negocio —remito↔cuenta corriente, coherencia litros×precio≈monto— viven en el servicio). El frontend consume los campos nuevos en el form de nueva carga como avisos blandos. El gating es un cambio de decoradores `@Roles` + roles del nav.

**Tech Stack:** NestJS + jest (Backend), Next.js 16 + vitest (Frontend).

**Spec:** `docs/superpowers/specs/2026-08-03-extraccion-v2-y-gating-admin-design.md`

## Global Constraints

- Backend: repo `...\Formulario_Horas\Backend`, rama `feature/modulo-combustible`. Comandos: `npx jest src/cargas-combustible`, `npx tsc --noEmit`.
- Frontend: repo `...\Formulario_Horas\Frontend`, rama `feature/modulo-combustible` (con el sidebar ya mergeado). Comandos: `npm run test`, `npx tsc --noEmit`.
- Textos de UI en español (es-AR). Avisos blandos: nunca bloquean el submit.
- La forma actual de `ExtraccionTicket` NO pierde campos — solo se agregan claves a `sugerencias`.
- Umbral de coherencia: 5% relativo al monto. Truncado de `lineaOrigenNumero`: 200 chars.
- Derivación de medio de pago: REMITO→'cuenta_corriente'; FACTURA_A|FACTURA_B|FACTURA_C|TIQUE→'caja'; OTRO o null→null.

---

### Task 1 (Backend): ampliar `ExtraccionTicket` y mapeo de `extraer()`

**Files:**
- Modify: `src/cargas-combustible/extraccion-ticket.service.ts`
- Test: `src/cargas-combustible/extraccion-ticket.service.spec.ts`

**Interfaces:**
- Consumes: JSON del modelo con claves nuevas (ya definidas en el PROMPT actual del archivo — no tocar el PROMPT).
- Produces: `ExtraccionTicket.sugerencias` ampliado (lo consume la Task 3 vía la respuesta HTTP de POST /cargas-combustible/extraer-ticket):

```ts
export type TipoComprobante = 'REMITO' | 'FACTURA_A' | 'FACTURA_B' | 'FACTURA_C' | 'TIQUE' | 'OTRO';
export type ExtraccionTicket = {
  legible: boolean;
  sugerencias: null | {
    litros: number | null; monto: number | null; fechaCarga: string | null;
    nroComprobante: string | null; tipoCombustibleId: number | null; estacionId: number | null;
    tipoComprobante: TipoComprobante | null;
    medioPagoSugerido: 'cuenta_corriente' | 'caja' | null;
    confianzaNumero: 'alta' | 'media' | 'baja' | null;
    lineaOrigenNumero: string | null;
    precioLitro: number | null;
    advertenciaCoherencia: string | null;
  };
};
```

- [ ] **Step 1: Tests que fallan** — agregar al spec existente (mockear como en los tests actuales; el mock del contenido del modelo devuelve JSON con los campos nuevos):

```ts
// dentro del describe existente, con el patrón de mocks ya usado en el archivo
const jsonModelo = (extra: object) => JSON.stringify({
  legible: true, litros: 62.575, monto: 168013.88, fecha: '2026-07-15',
  nroComprobante: 'R 0021-00059874', tipoCombustible: 'gasoil', estacion: 'YPF Centenario',
  ...extra,
});

it('deriva medioPagoSugerido cuenta_corriente para REMITO', async () => {
  // mock del modelo → jsonModelo({ tipoComprobante: 'REMITO' })
  // expect(r.sugerencias?.tipoComprobante).toBe('REMITO');
  // expect(r.sugerencias?.medioPagoSugerido).toBe('cuenta_corriente');
});
it('deriva medioPagoSugerido caja para FACTURA_B y TIQUE', async () => { /* ambos casos */ });
it('tipoComprobante inválido o ausente → null y medioPagoSugerido null', async () => {
  // jsonModelo({ tipoComprobante: 'CUALQUIERA' }) y jsonModelo({})
});
it('confianzaNumero passthrough validado, inválido → null', async () => {
  // 'alta' → 'alta'; 'altísima' → null
});
it('lineaOrigenNumero se trunca a 200 chars', async () => { /* string de 300 → length 200 */ });
it('advertenciaCoherencia cuando litros×precio difiere >5% del monto', async () => {
  // jsonModelo({ precioLitro: 2685 }) con monto 168013.88 → null (cierra, 62.575×2685=168013.88)
  // jsonModelo({ precioLitro: 3000 }) → advertencia no null, contiene ambos montos formateados
  // sin precioLitro → null
});
```

- [ ] **Step 2: Correr y ver fallar** — `npx jest src/cargas-combustible/extraccion-ticket.service.spec.ts` → FAIL (propiedades inexistentes).

- [ ] **Step 3: Implementar** en `extraccion-ticket.service.ts`:
  - `max_tokens: 512` → `1024` (solo el path Anthropic).
  - Exportar `TipoComprobante` y ampliar el type como arriba.
  - En `extraer()`, tras el parseo (mantener todo lo existente):

```ts
const TIPOS_COMPROBANTE: TipoComprobante[] = ['REMITO', 'FACTURA_A', 'FACTURA_B', 'FACTURA_C', 'TIQUE', 'OTRO'];
const tipoComprobante = TIPOS_COMPROBANTE.includes(json.tipoComprobante) ? (json.tipoComprobante as TipoComprobante) : null;
const medioPagoSugerido = tipoComprobante === 'REMITO' ? 'cuenta_corriente'
  : tipoComprobante && tipoComprobante !== 'OTRO' ? 'caja' : null;
const confianzaNumero = ['alta', 'media', 'baja'].includes(json.confianzaNumero) ? json.confianzaNumero : null;
const lineaOrigenNumero = typeof json.lineaOrigenNumero === 'string' ? json.lineaOrigenNumero.slice(0, 200) : null;
const precioLitro = typeof json.precioLitro === 'number' ? json.precioLitro : null;
const litros = typeof json.litros === 'number' ? json.litros : null;
const monto = typeof json.monto === 'number' ? json.monto : null;
let advertenciaCoherencia: string | null = null;
if (litros !== null && precioLitro !== null && monto !== null && monto > 0) {
  const calculado = litros * precioLitro;
  if (Math.abs(calculado - monto) / monto > 0.05) {
    advertenciaCoherencia = `Litros × precio unitario ($ ${calculado.toFixed(2)}) no coincide con el total ($ ${monto.toFixed(2)}).`;
  }
}
```

  y sumar las 6 claves nuevas al objeto `sugerencias` devuelto (reusando `litros`/`monto` ya calculados).

- [ ] **Step 4: Verde** — mismo comando, todos los tests del archivo PASS (los viejos también: los campos nuevos con mock sin claves extra dan null).
- [ ] **Step 5: `npx tsc --noEmit` limpio y commit** — `feat(combustible): extracción v2 — medio de pago sugerido, confianza y coherencia server-side`

---

### Task 2 (Backend + Frontend): gating temporal Admin-only

**Files:**
- Modify: `src/cargas-combustible/cargas-combustible.controller.ts` (Backend)
- Modify: `src/components/layout/nav.ts` (Frontend)
- Test: `src/components/layout/nav.test.ts` (Frontend, ajustar casos existentes)

**Interfaces:** ninguna nueva; cambio de autorización puro.

- [ ] **Step 1 (Frontend): ajustar tests de nav que hoy afirman lo contrario** — en `nav.test.ts`: los tests "JefeCuadrilla ve Combustible" y "JefeContrato ve Combustible" pasan a `not.toContain('/combustible')` con nombres "JefeCuadrilla NO ve Combustible (gating temporal Admin)" etc.; agregar `it('Admin ve Combustible', ...)` con `toContain('/combustible')`. Correr `npm run test -- src/components/layout/nav.test.ts` → FAIL (rojo esperado).
- [ ] **Step 2 (Frontend): `nav.ts`** — ítem `/combustible`: `roles: ['Admin']` con comentario `// TEMPORAL: solo Admin hasta afinar el módulo (spec 2026-08-03; originales: JefeCuadrilla, JefeContrato, Admin)`. Test verde.
- [ ] **Step 3 (Backend): las 8 rutas del controller** a `@Roles('Admin')`, cada una con el mismo comentario de temporalidad en una sola línea encima del bloque de la clase (no repetir 8 veces; un comentario arriba del controller alcanza, dejando los originales anotados). Correr `npx jest src/cargas-combustible` → los specs del controller/service existentes deben seguir verdes (si algún spec afirma roles, ajustarlo).
- [ ] **Step 4: typecheck ambos repos y commits** — uno por repo: `chore(combustible): gating temporal Admin-only (backend)` / `chore(combustible): gating temporal Admin-only (nav)`.

---

### Task 3 (Frontend): consumir sugerencias v2 en el form de nueva carga

**Files:**
- Modify: `src/types/domain.ts` (o donde viva el type de la respuesta de extraer-ticket — buscarlo con grep `sugerencias`)
- Modify: `src/app/(protected)/combustible/nueva/page.tsx`
- Test: el test existente del form de nueva carga (buscar `nueva` bajo `src/app/(protected)/combustible/`; si no existe, crear `nueva/page.test.tsx` siguiendo el patrón de los page-tests de admin)

**Interfaces:**
- Consumes: la respuesta ampliada de POST /cargas-combustible/extraer-ticket (shape exacto en Task 1 "Produces"). El type del Frontend debe replicarlo.

Comportamiento (todos avisos blandos, nunca bloquean submit):

1. **Preselección de medio de pago:** al aplicar sugerencias, si `medioPagoSugerido` no es null y el usuario todavía no tocó el select de medio de pago (trackear con ref booleana `medioPagoTocado`, seteada en el onChange del select), setear el valor sugerido. Seguir el patrón existente del archivo para aplicar sugerencias (refs espejo, ver comentario en page.tsx:89-91).
2. **Aviso por contradicción:** si hay `medioPagoSugerido` y el valor actual del select difiere, mostrar bajo el select: `La foto parece {remito (cuenta corriente)|factura o tique (caja)}.` — texto ámbar, estilo de los warnings existentes del form (buscar la advertencia de km para copiar clases).
3. **Chip de confianza + línea de origen:** donde el form ya muestra el badge de sugerencia del nro. de comprobante, agregar chip con `Confianza: {alta|media|baja}` (clases: alta `bg-success/10 text-success`, media `bg-warning/10 text-warning`, baja `bg-danger/10 text-danger` — verificar contra los tokens de color reales del proyecto en tailwind config/globals y usar los equivalentes) y, si hay `lineaOrigenNumero`, texto chico gris: `Leído de: «{linea}»`.
4. **Aviso de coherencia:** si `advertenciaCoherencia` no es null, mostrarla bajo el campo monto con el mismo estilo ámbar.

- [ ] **Step 1: Tests que fallan** (mockear la mutación de extraer como hagan los tests existentes del form; si no hay test del form, crear con el patrón de los page-tests):
  - aplica sugerencias con `medioPagoSugerido: 'cuenta_corriente'` → el select queda en cuenta corriente.
  - usuario ya eligió caja (interactuar antes) + sugerencia cuenta_corriente → select NO cambia y aparece el aviso "La foto parece un remito".
  - `confianzaNumero: 'baja'` → aparece chip "Confianza: baja"; `lineaOrigenNumero` → aparece "Leído de:".
  - `advertenciaCoherencia: 'X no coincide Y'` → visible bajo monto.
- [ ] **Step 2: rojo** — `npm run test -- <archivo>` FAIL.
- [ ] **Step 3: implementar** los 4 puntos.
- [ ] **Step 4: verde + suite completa + `npx tsc --noEmit`.**
- [ ] **Step 5: commit** — `feat(combustible): sugerencias v2 en el form — medio de pago, confianza y coherencia`
