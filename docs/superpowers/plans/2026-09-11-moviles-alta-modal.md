# Móviles (Admin): alta en modal y baja de la carga masiva

Fecha: 2026-09-11 · Repo: **Frontend** (+ docs en Backend)
Misma rama y mismo PR que `2026-09-11-moviles-paginado-filtro.md`.

## 1. Qué se pide

Pedido textual: *"me gustaria re-modificar el apartado de carga masiva por csv,
ya que ya se cargaron y no es necesario ya hacrlo masivamente, apart que
visualmente uqeda horrible. Ademas pondria un boton de añadir movi que abra un
pequeño formulario pidiendo los campos necesarios para crear un movil nuevo y
no como esta aora que estan los campos a la vista para completar"*

## 2. Decisiones cerradas

| Decisión | Resuelto |
|---|---|
| Carga masiva | Se saca de la UI y del código del Frontend (bloque, hook `useCrearMovilesMasivo`, tipo `AltaMovilesMasivaResp`, helper `parsearIdentificadores` y sus tests). **El endpoint `POST /admin/moviles/masivo` del Backend queda vivo sin consumidor**, como salida de emergencia |
| Alta | Botón `+ Añadir móvil` en el `action` del `PageHeader`, que abre un modal |
| Modal | `Dialog` de la casa (base-ui), patrón de `cerrar-quincena-dialog.tsx` |
| Campos | Patente (obligatoria) y Descripción (opcional). `activo` lo pone el Backend |
| Rótulos | "Identificador" → **"Patente"** en toda la pantalla, incluida la fila editable. El contrato con la API sigue usando la clave `identificador` |
| PR | El mismo de la paginación |

## 3. Lo que ya existe y hay que reusar

- **`PageHeader` ya acepta `action?: ReactNode`** y lo alinea a la derecha con
  `flex flex-wrap items-end justify-between` — no hay que envolverlo en nada, y
  el `flex-wrap` resuelve solo los 375px. Lo usan así `admin/tipos-combustible`
  y `admin/estaciones-servicio`.
- **Patrón "botón abre modal"**: `liquidacion/quincena/detalle/page.tsx:240-248`
  — estado booleano en la página, botón en `action`, y abajo
  `{creando && <Dialog onCancel={…} />}`. El diálogo se monta condicionalmente y
  adentro lleva `open` fijo en true; **quien lo desmonta es el padre**.
- **Composición del diálogo**: `Dialog > DialogContent > DialogHeader(DialogTitle
  + DialogDescription) > campos > DialogFooter(Button ghost "Cancelar" + Button
  primary)`. Los botones son los de `@/components/button`; el variant `ghost`
  está documentado como "el Cancelar de los diálogos".
- **Los tests del diálogo no necesitan nada especial**: el portal de base-ui cae
  en `document.body` y `screen` lo ve. El único polyfill (`ResizeObserver`) ya
  está en `vitest.setup.ts`. Patrón de test a copiar:
  `admin/tipos-combustible/tipos-page.test.tsx:32-44`.
- **Guardar y cerrar solo si la mutación anduvo**: `movil-edit-row.tsx:34-45`.

## 4. Pasos

**Paso 0 — Línea de base.** Commitear primero, solo, el ajuste cosmético
pendiente (estados vacíos aplanados) para que el diff quede legible. `npm test`
y `npm run lint`; anotar el total.

**Paso 1 — Sacar la carga masiva.** En el test: borrar los dos tests de listado
y sacar `crearMasivo` del mock → el rojo es que `page.tsx` sigue importando un
hook que el mock ya no exporta. Después limpiar `page.tsx` (import, estado
`listado`, `parsearIdentificadores`, `cargarListado`, bloque JSX) y `admin.ts`
(hook + tipo).
Verificación: `npx vitest run moviles-page` → 11 verdes; lint limpio; grep de
`useCrearMovilesMasivo|AltaMovilesMasivaResp|parsearIdentificadores` en cero.

**Paso 2 — Renombre en la fila (TDD).** Primero las 4 apariciones de
`getByLabelText('Identificador')` en `movil-edit-row.test.tsx` → `'Patente'`
(3 de 4 tests en rojo), después el componente. El estado interno y el payload
`{ identificador }` **no se tocan**.

**Paso 3 — `CrearMovilDialog` (TDD, archivos nuevos).** Test primero, con estos
casos: rótulos y botones presentes; `Crear` deshabilitado con patente vacía o
de solo espacios; llama al mutate con `descripcion: undefined` si está vacía y
con la descripción trimeada si no; cierra en éxito y **queda abierto en error**;
`Cancelar` cierra sin crear.

**Paso 4 — Integrar en la página (TDD).** Test primero: el botón abre el modal
(antes `queryByLabelText('Patente')` ausente), tipear y crear llama al mutate;
`Cancelar` cierra sin crear. Después `page.tsx`: sacar el bloque de alta inline
y `agregar()`, agregar `creando` + `action={<Button>+ Añadir móvil</Button>}` +
`{creando && <CrearMovilDialog onClose={…} />}`. Buscador, lista y paginador no
se tocan.
Verificación: los tres archivos de test verdes; `npm test` completo; lint; tsc.

**Paso 5 — Verificación visual y OK del usuario.** Header con el botón a la
derecha; a 375px baja sin scroll horizontal; el modal cierra con Cancelar, con
la X y con Esc; `Crear` deshabilitado hasta tipear; crear una patente
claramente falsa, verla en la lista y desactivarla; filtro, paginación y
"Editar ▾" siguen igual. **Mostrar y esperar el OK antes del PR.**

**Paso 6 — PR.** Commits sobre la rama existente; el PR describe las dos partes
y aclara que **no tiene par en Backend**. Merge con `--admin`. Sin deploy.

**Paso 7 — Docs en Backend.** Este plan; una línea en el plan anterior diciendo
que quedó superado el mismo día; la `## 86.` del contexto cubriendo toda la
rama.

## 5. Riesgos

- **Dialog montado permanente en vez de condicional.** Si se hace
  `<Dialog open={creando}>` siempre montado, base-ui puede dejar el popup en el
  DOM durante la animación de salida y el formulario conserva estado entre
  aperturas. Mitigación: copiar exacto el `{creando && <…/>}` de detalle.
- **Colisiones de nombre accesible**: con el modal abierto y una fila expandida
  conviven dos `Cancelar`. Mitigación: los tests no hacen las dos cosas a la
  vez; usar `/^crear$/i`.
- **Mock desincronizado**: sacar el hook del mock pero no del código rompe. Es
  justamente el rojo del paso 1.
- **Datos reales en el paso 5**: el dev local apunta a `testing`, no a
  producción — verificado. Aun así, patente obviamente falsa y desactivarla.
- **Duplicado de patente**: el Backend rechaza y el toast dice "No se pudo
  crear" (genérico, igual que hoy); el modal queda abierto para corregir.
- Sin DDL, sin cambio de API. Rollback = revertir el PR del Frontend.

## 6. Decisiones sobre las preguntas abiertas

1. El modal **espera la mutación** y cierra solo en éxito (igual que la fila).
2. La patente **se normaliza antes de enviar** con `normalizarPatente`, para que
   la base no reciba `aa 615 nf` cuando el glosario dice que van sin separadores.
3. Placeholder `AB123CD` — misma forma que una patente real pero inexistente en
   la base, para no invitar a cargar un duplicado.
4. Enter no envía: ninguna pantalla hermana lo hace.
5. Texto del botón: `+ Añadir móvil` literal.
6. Un solo PR de docs con la `## 86.` cubriendo toda la rama.

## 7. Fuera de alcance

Cualquier cambio en Backend; renombrar `identificador` → `patente` en el tipo,
los payloads o la base; migrar otros diálogos de admin; mensajes de error por
código (409 duplicado); volver a página 1 tras crear; deploy.
