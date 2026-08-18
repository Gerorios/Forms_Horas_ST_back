# Extracción de tickets de combustible con alta confianza — Implementation Plan

> Grilling 2026-08-18 con el dueño de producto. Criterio rector: **MÁXIMA PRECISIÓN
> — mejor un campo vacío que un dato equivocado.** El error caro no es el hueco: es
> el error silencioso que se descubre recién en la liquidación.

**Goal:** que la estación, el móvil y el número de remito extraídos del ticket sean
confiables, aplicando RAG (los catálogos de la empresa viajan en el prompt) +
doble lectura con consenso + verificaciones estructurales.

**Proveedor:** OpenAI `gpt-5.1` (donde el usuario tiene créditos). Verificado
2026-08-18: en producción solo está `OPENAI_API_KEY`, la rama Anthropic del código
nunca se ejecuta.

## Decisiones del grilling (no re-litigar)

1. **Máxima precisión** sobre cobertura: ante duda, campo vacío.
2. **Estación y móvil son obligatorios y se eligen de un desplegable.** La extracción
   solo los **pre-selecciona** cuando está segura. No se puede guardar sin ellos.
3. **Número de remito**: doble lectura + verificación aritmética + anti-duplicado.
4. **Aprendizaje**: si el CUIT del ticket confirma la estación elegida → alias
   automático. Sin CUIT confirmatorio → alias **sugerido**, aprobado por Admin.
5. **Doble lectura con gpt-5.1** (dos llamadas al mismo modelo, en paralelo).

## Por qué RAG simple (sin embeddings ni base vectorial)

Catálogos reales al 2026-08-18: **47 estaciones** (39 con CUIT), **79 móviles**,
5 tipos de combustible = 131 ítems ≈ 2K tokens. Entran completos en el prompt. Las
bases vectoriales resuelven el problema de "millones de documentos que no entran";
acá no existe ese problema. Pasar el catálogo entero da el ~95% del beneficio con
cero infraestructura nueva.

**El cambio conceptual**: hoy el modelo lee a ciegas (`"ESTACION SVR SRL"`) y el
código intenta adivinar después con comparación de strings (falla con OCR imperfecto,
y su regla de "uno contiene al otro" puede dar falsos positivos). Con RAG el modelo
**elige de una lista cerrada** y puede resolver "SVR"→"SUR" porque ve los candidatos.

---

# Parte A — Backend

### Task B1: Proveedor de IA explícito

**Problema:** hoy `extraccion-ticket.service.ts:99-101` elige Anthropic si existe
`ANTHROPIC_API_KEY`, si no OpenAI. Cargar esa variable cambiaría el modelo en
silencio.

- Variable `IA_PROVEEDOR` (`openai` | `anthropic`, default `openai`); el proveedor
  se loguea al arrancar. Sin clave del proveedor elegido → error explícito de config.
- Spec: con `IA_PROVEEDOR=openai` y ambas claves presentes, se llama a OpenAI.

### Task B2: RAG — catálogos en el prompt, el modelo elige de la lista

**Files:** `src/cargas-combustible/extraccion-ticket.service.ts`

- Traer los catálogos **antes** de llamar al modelo (hoy se traen después): estaciones
  (`id`, nombre, CUIT, alias), móviles (`id`, identificador), tipos (+ alias).
- Inyectarlos en el prompt como listas con ID, y cambiar el contrato de salida:
  - `estacionId`: number|null — **debe salir de la lista**; null si no está seguro.
  - `movilId`: number|null — ídem.
  - `estacionLeida` / `patenteLeida`: string|null — el texto crudo tal como se lee
    (para auditoría y para generar alias en B5).
  - `confianzaEstacion` / `confianzaMovil`: `"alta"|"baja"`.
- Instrucción explícita en el prompt: **"si no podés determinarlo con certeza,
  devolvé null. Es preferible null a una elección dudosa."**
- El matcheo por texto actual (`matchear`) queda como **red de respaldo** solo cuando
  el modelo devuelve null y hay CUIT exacto (dato duro).
- Specs: elige de la lista ante variantes ("ESTACION SVR SRL" → id correcto);
  devuelve null ante ambigüedad; nunca inventa un id fuera del catálogo.

### Task B3: Doble lectura y consenso

- Dos llamadas en paralelo (`Promise.all`) al mismo modelo con el mismo prompt.
- **Regla de consenso, campo por campo**: si ambas lecturas coinciden → se acepta.
  Si difieren → el campo va **null** y se marca en `camposInseguros: string[]`.
- Números (litros, precio, monto) deben coincidir exactamente; textos, normalizados.
- Si una de las dos llamadas falla → se degrada a lectura simple y **todos** los
  campos quedan marcados como inseguros (coherente con máxima precisión).
- Specs: coincidencia → valor; discrepancia → null + campo listado; fallo de una
  llamada → modo degradado.

### Task B4: Verificaciones estructurales

- **Aritmética**: si `|litros × precioLitro − monto| > 1` (tolerancia de redondeo) →
  `alertaAritmetica: true` y los tres campos quedan marcados como inseguros.
- **Anti-duplicado**: buscar en `sth_cargas_combustible` misma
  `nroComprobante` + `estacionId` no anulada → `alertaDuplicado` con el id existente.
- Specs por cada regla, incluidos los casos borde (campos null → sin alerta).

### Task B5: Alias de estaciones (aprendizaje)

- **DDL nuevo** `sth_estacion_alias` (id, estacion_id, alias, aprobado, creado_por,
  created_at) — **a las DOS bases**, siguiendo el patrón de
  `sth_tipo_combustible_alias`.
- Al **confirmar** una carga: si hubo `estacionLeida` que no matcheaba y el operario
  eligió estación X:
  - Si el CUIT leído == CUIT de X → alias **aprobado automáticamente**.
  - Si no → alias **sugerido** (`aprobado = false`), sin efecto hasta que un Admin lo
    apruebe.
- Los alias aprobados entran al catálogo que viaja en el prompt (B2).
- Endpoints Admin: listar/aprobar/rechazar (espejo de los alias de combustible).

---

# Parte B — Frontend

### Task F1: Estación y móvil obligatorios

- En `combustible/nueva`: ambos son `<select>` **obligatorios**; sin ellos el botón de
  guardar queda deshabilitado con el motivo visible.
- Pre-seleccionados solo si el backend los devolvió (o sea: solo si hubo certeza).

### Task F2: Señales de confianza en la UI

- Los campos listados en `camposInseguros` se muestran vacíos y **marcados**
  ("Revisá este dato: la lectura no fue concluyente"), con la foto a mano para
  cotejar.
- Banner de `alertaDuplicado` ("Ya existe una carga con ese remito para esta
  estación — ver carga #N") y de `alertaAritmetica` ("Litros × precio no coincide con
  el monto").
- El número de remito, si quedó inseguro, exige confirmación explícita del operario.

### Task F3: Admin de alias de estaciones

- Pantalla espejo de la de alias de combustible, con la cola de alias **sugeridos**
  para aprobar/rechazar.

---

## Verificación

- Backend: TDD en cada task; suite completa verde; build limpio.
- Frontend: tests de las reglas nuevas (obligatoriedad, marcas de inseguridad,
  alertas) + `tsc`.
- **Prueba de campo antes del merge**: correr el flujo en local contra `testing` con
  fotos reales de tickets (incluidas las que hoy fallan) y comparar contra lo que
  extrae el sistema actual.

## Salida

Ramas `fix/extraccion-alta-confianza` en ambos repos → PRs con cuerpo explicativo →
merge → deploy (DDL de `sth_estacion_alias` a las DOS bases) → sección de contexto.
