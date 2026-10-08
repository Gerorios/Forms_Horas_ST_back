# Brief de diseño — Rediseño ERP de Central SER&TEC (2026-10-07)

Brief de `impeccable shape` (modo Operate), confirmado con el usuario por partes en la sesión del 2026-10-07.
Referencias: `Frontend/PRODUCT.md`, `Frontend/DESIGN.md` (sistema visual vigente) y la revisión
`Frontend/.impeccable/critique/2026-10-05-revision-completa.md` (fuera de git). Decisiones de negocio en
`Backend/.claude/Contexto/estado.md`. Este brief no es el plan: el plan lo arma el planificador a partir de acá.

## 1. Trabajo y audiencia

- Sistema interno tipo ERP de SER&TEC. La oficina en PC es la usuaria primaria (Liquidador, JefeContrato, HyS,
  Supervisor, Admin, Facturación con claim `cert`); el campo usa el celular solo para Reporte diario, Mis registros
  y Combustible (equipos básicos, mala conexión).
- Modo **Operate**: la persona viene a completar una tarea. La claridad, la densidad y lo conocido mandan sobre la
  expresión.

## 2. Resultado

- Que cada persona sepa al entrar qué le toca y llegue en un toque a resolverlo.
- Que el circuito de la quincena (cargado → aprobado → liquidado → cerrado) se vea en todo el sistema.
- Que nada de riesgo (bajas, desactivar, aprobar con alertas, cerrar) se haga sin ver qué afecta.
- Que las reglas del usuario se cumplan en todas las pantallas (tablas sin scroll horizontal, Recharts, marca desde
  `src/lib/marca.ts`, horas con un decimal, letra mínima de 11 px).

## 3. Dirección elegida

**Identidad:** se conserva "La Consola de Obra" de `DESIGN.md`: consola grafito, contenido sobre arena, dorado
SER&TEC como señal, Space Grotesk + IBM Plex. Se evoluciona, no se reemplaza. Cambio de sistema ya aprobado: el
rótulo en mayúsculas sobre el título se reemplaza por una **línea de dato vivo** (período, estado o conteo; sin
dato, sin línea).

**Arquitectura de información (6 módulos, menú lateral de dos niveles, sin pestañas arriba):**

| Módulo | Pantallas |
|---|---|
| Operación | Reporte diario · Mis registros · Aprobaciones · Km por tantos · Tablero de productividad (ex Control general) |
| Personal | Ausencias (Ausencia + Accidente) · Bajas · Suspensiones (Suspensión + Franco) · Operativa (Viático + Guardia Pasiva) |
| Liquidación | Quincenas · Cierres · Perfiles · Tarifas · Tablero de costos (ex Análisis) |
| Facturación | Certificaciones: Resumen (con Incidencia de MO) · Cargar · Historial · Ítems · Tablero de certificaciones (ex Analytics) |
| Flota | Cargas de combustible · Nueva carga · Móviles · Estaciones de servicio · Tipos de combustible |
| Administración | Usuarios · Accesos · Contratos · Tareas · Provincias · Tipos de novedad · Categorías UOCRA |

La visibilidad sigue siendo por rol y claim, como hoy (`navForRole`): el rediseño no cambia permisos.

**Estructuras por superficie (elegidas con `concept-seed`):**

- **Inicio "Mi trabajo" — Línea de la quincena:** banda Cargado → Aprobado → Liquidado → Cerrado con su avance; los
  pendientes del rol aparecen en la etapa que le toca, cada uno como enlace directo. Todos los roles tienen su
  contenido (Admin y Supervisor incluidos). En celular, versión simple. Sin tarjetas-enlace a módulos.
- **Personal (4 pantallas, misma estructura):** contadores arriba (por estado en Ausencias, Bajas y Suspensiones;
  por tipo en Operativa) que filtran la lista; **lista con panel de detalle al costado** (certificados, quién
  cargó, efectos, acciones de HyS). Cada pantalla con su botón de carga. En celular el detalle abre aparte.
- **Aprobaciones — dos grupos con tarjetas informativas:** "Con alertas" (alerta, contrato y horas a la vista;
  botón principal Revisar; no se aprueban desde la lista) y "Limpias" (tildadas, "Aprobar seleccionadas").
  Todas las quincenas. **Revisar abre el detalle al costado** (mismo patrón que Personal): encabezado (día, quién y
  cuándo cargó, provincia, móviles), agrupado por contrato con tareas y "Corregir horas", operarios con horas y
  alerta junto al nombre, lo de otro jefe en gris solo lectura, aprobar/desaprobar seleccionados, "Siguiente
  carga". Deshacer unos segundos.
- **Reporte diario — el formulario de hoy, para celular:** campos de 44 px, botón fijo abajo, ir al primer error,
  borrador local; **frecuentes automáticos** (chips con los operarios y móviles que ese jefe cargó más en las
  últimas semanas, arriba de la búsqueda, a partir de `cargadoPorCuil`).
- **Liquidación → Quincenas — tablero por estado:** columnas En curso / Con alertas / Lista para cerrar / Cerradas.
  Cada quincena lista sus pendientes como **una línea que es el enlace** ("6 registros sin aprobar →",
  "3 perfiles incompletos: PAZ L., … →", "2 bajas sin confirmar →"), con datos de `GET /liquidacion/quincena/alertas`;
  "Revisar y cerrar" en la lista; cerradas con versión, fecha, total, Ver cierre y Excel. El detalle de una quincena
  suma encabezado de estado ("Abierta" / "Cerrada v3 · 17/09"), totales y aviso de que recerrar crea versión.
- **Liquidación → Tarifas — ronda mensual por pasos:** entrada con la lista de meses y su estado (sin cargar /
  "N de 6, falta X" / completa), el mes a cargar destacado. Dentro, 6 pasos en orden (Precio por hora → Bono → Plus
  de novedades → Km por tantos → Plus individual → Sueldos mensualizados), tocables sueltos para corregir, con
  "usar los del mes anterior" y "sin X este mes" donde aplique. Un solo período para todo.
- **Patrón de catálogo (los 10 de Flota y Administración) — tabla + fila desplegable:** buscador, total, paginación
  y la misma alta ("Nuevo X") en todos; pastilla de estado de solo lectura; "Desactivar…" dentro de la edición con
  confirmación que dice el efecto.
- **Resto, misma forma + estilo nuevo + arreglos de la revisión:** Mis registros, Km por tantos, Tablero de
  productividad, Cierres, Perfiles, Facturación (todas sus pestañas), Combustible.

**Componentes comunes que nacen del rediseño:** menú de dos niveles; encabezado con línea de dato vivo; patrón
lista + panel de detalle (Personal y Aprobaciones); `ConfirmDialog` sobre `ui/dialog` (reemplaza los 17 modales
hechos a mano); pastilla de estado de solo lectura; formato humano de fechas, importes, nombres y roles;
íconos lucide en lugar de glifos.

## 4. Alcance y límites

- Todo el Frontend. Backend solo donde haga falta: campo **Grupo** en tipos de novedad (DDL), y lo que pidan los
  pendientes del Inicio y los controles nuevos (por ejemplo, estado completo/incompleto de cada mes de Tarifas).
- No se tocan reglas de negocio, cálculo de liquidación, cierres ni permisos.
- No se reemplaza la identidad visual. No se agrega modo oscuro.
- Entrega: PRs por etapa sobre una **rama de integración**; nada a `main` ni a producción hasta que el usuario vea
  el producto final en local. DDL de Grupo solo en `testing` hasta el merge final.

## 5. Estados y rangos

- Usuarios: ~70; móviles: ~80; estaciones: ~47; empleados en liquidación: ~105 por quincena; contratos: 8 (K2-K12).
- Estados a cubrir en cada pantalla: cargando (skeleton, no "Cargando…" en texto), vacío con salida, error con el
  motivo, sin permiso, y en Liquidación "sin calcular" (nunca mostrar −100 % en verde).
- Bandejas: pendientes de **todas las quincenas**, no solo la actual.

## 6. Interacción y distribución

- Escritorio: consola lateral de dos niveles plegable; contenido sobre arena. Celular: barra superior y menú
  desplegable; las tres pantallas de campo, a 390 px.
- Tocar un pendiente lleva directo a resolverlo. Acciones irreversibles con confirmación que nombra a quién afecta y
  botón con verbo. Deshacer breve en aprobar.
- Teclado: foco visible (dorado con separación) y filas desplegables accesibles.

## 7. Restricciones y decisiones abiertas

- Reglas que mandan sobre la skill: `CLAUDE.md` raíz y `Frontend/CLAUDE.local.md`.
- Cada etapa visual del plan incluye: estructura ya elegida (este brief), lectura de `craft-floor.md` y
  `DESIGN.md` antes de editar, e `impeccable critique` al cerrar.
- Abiertas para el plan (no las inventa el ejecutor): qué muestran Admin y Supervisor en el Inicio; de dónde salen
  "Cargado" y "Aprobado" de la quincena en curso (hoy no hay un endpoint único); el cálculo del estado de cada mes
  en Tarifas; el orden y el corte de las etapas.
- `DESIGN.md` se actualiza con los componentes nuevos (menú de dos niveles, lista + detalle, ConfirmDialog) al
  cerrar la etapa base. ADR-027 (módulos, reemplaza las áreas del ADR-025) y `CONTEXT.md` ("Grupo de novedad").
