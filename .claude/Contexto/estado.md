# Estado del trabajo

Solo lo vivo: lo que está en curso, el próximo paso, lo que espera al usuario y lo que quedó para más adelante.
Lo entregado no va acá: su cierre está en `contexto-proyecto.md` (la bitácora, la más reciente arriba). La regla
está en el `CLAUDE.md` de la raíz `Formulario_Horas` ("Estado del trabajo"). Última actualización: **2026-10-08**.

## En curso

- **Rediseño completo del Frontend como ERP — PAUSADO el 2026-10-08** (pedido del usuario: Rodrigo tiene trabajo
  nuevo; primero entra su PR y el rediseño arranca después, sobre lo que él hizo). Quedó en la fase 2
  (aprobación del plan, "no aún"). Carril completo de `flujo-sertec`, entrevista arrancada el 2026-10-07: reordenar la arquitectura de información por módulos y la estética, con la skill impeccable. Insumos:
  `Frontend/PRODUCT.md`, `Frontend/DESIGN.md` (sin commitear, van al final) y la revisión del 2026-10-05 en
  `Frontend/.impeccable/critique/2026-10-05-revision-completa.md` (fuera de git). La "Tanda 1" de arreglos quedó en
  espera dentro de este rediseño.

  Decisiones cerradas en la entrevista:
  1. **Alcance:** reordenar + evolucionar. Se conserva la identidad (logo, dorado, grafito, tipografías); se rehace
     la organización en módulos y se pule la estética. Incluye los arreglos de la revisión.
  2. **Tableros dentro de su módulo** (no un módulo Análisis aparte): productividad en Operación, costos en
     Liquidación, certificaciones en Facturación. El cruce certificado vs. liquidación ya existe: es la Incidencia
     de MO del Resumen de certificaciones.
  3. **Personal = una pantalla por tema**, cada una con su carga y su resolución: Ausencias (Ausencia + Accidente),
     Bajas (Baja de Operario), Suspensiones (Suspensión + Franco), Operativa (Viático + Guardia Pasiva).
  4. **Campo "Grupo" en el catálogo de tipos de novedad** (Ausencias/Bajas/Suspensiones/Operativa), elegible por el
     Admin. Requiere DDL en `testing` y `Horas_Sertec`.
  5. **Módulo Flota** propio: cargas de combustible + Móviles, Estaciones y Tipos de combustible. Operación queda
     solo para horas (Reporte, Mis registros, Aprobaciones, Km por tantos, Tablero de productividad).
     Administración: Usuarios, Accesos, Contratos, Tareas, Provincias, Tipos de novedad, Categorías UOCRA.
  6. **Menú de dos niveles** (módulo desplegable con sus pantallas); se quitan las pestañas de arriba.
  7. **Inicio "Mi trabajo" por rol** (pendientes de cada uno con enlace; también Admin y Supervisor) + estado de la
     quincena en curso (cargado → aprobado → liquidado → cerrado). Sin tarjetas-enlace.
  8. **Entrega:** PRs separados por etapa sobre una **rama de integración** (no a `main`); nada se mergea a `main` ni
     va a producción hasta que el usuario vea el producto final en local. El DDL de Grupo va primero solo a
     `testing`; a `Horas_Sertec` recién con el merge final.
  Módulos: Operación, Personal, Liquidación (Quincenas, Cierres, Perfiles, Tarifas, Tablero de costos), Facturación
  (Certificaciones con Incidencia de MO; Tablero de certificaciones), Flota, Administración. Vocabulario nuevo →
  ADR-027 (reemplaza las áreas del ADR-025) y `CONTEXT.md` ("Área", "Grupo de novedad").

  Estructuras elegidas con impeccable (`concept-seed`, modo operate; regla nueva: todo diseño del Front con la
  skill, ver `CLAUDE.md` raíz):
  - **Inicio "Mi trabajo" = Línea de la quincena** (Cargado → Aprobado → Liquidado → Cerrado con su avance; los
    pendientes del rol en la etapa que le toca). Seed 1e05adc5.
  - **Personal (las 4 pantallas) = contadores arriba + lista con panel de detalle al costado** (combinación de
    "tablero por estado" y "lista + detalle"): contadores por estado en Ausencias/Bajas/Suspensiones, por tipo en
    Operativa; tocar un contador filtra; en celular el detalle se abre aparte. Seed 27a59670.
  - **Aprobaciones = dos grupos con tarjetas informativas** (combinación de "dos grupos" y "tarjetas con alerta a
    la vista"): "Con alertas" (botón principal Revisar, no se aprueban desde la lista) y "Limpias" (tildadas,
    "Aprobar seleccionadas"); todas las quincenas; Deshacer unos segundos. **Revisar abre el detalle al costado**
    (mismo patrón que Personal): encabezado (día, cargó y cuándo, provincia, móviles), agrupado por contrato con
    tareas y "Corregir horas", operarios con horas y alerta junto al nombre, lo de otro jefe en gris solo lectura,
    aprobar/desaprobar seleccionados, "Siguiente carga". Seed 9e90f997.
  - **Reporte diario = el formulario de hoy, mejorado para celular** (campos de 44 px, botón fijo, ir al primer
    error, borrador) **+ frecuentes automáticos**: chips con los operarios y móviles que ese jefe cargó más en las
    últimas semanas, arriba de la búsqueda (del historial `cargadoPorCuil`, sin DDL). Seed 90dc8207.
  - **Liquidación → Quincenas = tablero por estado** (En curso / Con alertas / Lista para cerrar / Cerradas). Cada
    quincena lista sus pendientes como **una línea que es el enlace** (ej. "6 registros sin aprobar →" a
    Aprobaciones, "3 perfiles incompletos: PAZ L., …" a Perfiles, "2 bajas sin confirmar" a Personal › Bajas),
    con los datos de `GET /liquidacion/quincena/alertas`; "Revisar y cerrar" en la lista; cerradas con versión,
    fecha, total, Ver cierre y Excel. Seeds 61cde1c3 (+ re-roll 1, rechazado).
  - **Liquidación → Tarifas = ronda mensual por pasos.** Entrada: lista de meses con su estado (sin cargar /
    "N de 6 pasos, falta X" / completa) y el mes a cargar destacado. Dentro: 6 pasos en orden (Precio por hora →
    Bono → Plus de novedades → Km por tantos → Plus individual → Sueldos mensualizados), cada uno tocable suelto
    para corregir, con "usar los del mes anterior" y "sin X este mes" donde aplique. Un solo período para todo;
    "Sueldos" deja de ser sub-pestaña. Seed 0cb4e0d3.
  - **Patrón común de catálogo (los 10 de Flota y Administración) = tabla + fila desplegable:** buscador, total,
    paginación y la misma alta ("Nuevo X") en todos; la pastilla de estado es solo lectura; "Desactivar…" dentro
    de la edición, con confirmación que dice el efecto. Seed 8403c4b5.
  - Resto de pantallas sin ronda: misma forma + estilo nuevo + arreglos de la revisión (Mis registros, Km por
    tantos, Tablero de productividad, Cierres, Perfiles, Facturación, Combustible).
  - Regla de presentación pedida por el usuario: **pantallas existentes se muestran como antes/después** sobre la
    pantalla real, no como estructuras nuevas sueltas.
  - Menú de dos niveles: sin ronda (ya decidido).

## Próximo paso

1. Subir a GitHub la guía de ramas (`docs/flujo-de-ramas.md`, `main` = producción, `dev` = integración) para que
   Rodrigo actualice su forma de trabajar.
2. Rodrigo sube su PR (contra `dev`); lo revisamos juntos con el usuario y, si está bien, se mergea.
3. Retomar el rediseño ERP sobre lo que hizo Rodrigo: plan en `docs/superpowers/plans/2026-10-07-rediseno-erp.md`
   (brief `2026-10-07-rediseno-erp-brief.md`), en fase 2; la rama de integración es `dev` (no `rediseno-erp`).
   Faltan el OK y las preguntas abiertas de §5 (P1-P7, P10-P12, con default). Decidido: P9 Cargar primero en
   Facturación; un Accidente no afecta presentismo (no se pregunta). Revisar el plan contra el trabajo de Rodrigo.

## Pendientes del usuario

- **Hotfix §104 (deployado 2026-10-07):** probarlo en producción (confirmación al tocar "Activo"; Pendientes con
  quincenas anteriores). Reactivar a SALAS MARIA JOSE en `testing` (quedó inactiva en la revisión del 2026-10-05).

- **Baja de Operario (§103):** que HyS revise las 2 bajas que quedaron pendientes en su bandeja (últimos días
  trabajados 29/09 y 05/10) y las confirme o rechace. Probar la feature en producción.

- **Clave SSH:** guardar una copia de `~/.ssh/forms_horas_vps2` en un lugar seguro (es la única forma de entrar por
  SSH y no tiene frase de protección). Confirmar con Rodrigo cómo entra, y averiguar de quién es la clave
  `claude-code@forms-horas-vps` cargada en `root` (no es de la PC del usuario).
- **Pedido a IT:** restringir MySQL `191.101.235.7:3306` (hoy abierto a internet) a la IP de la VPS y la de la oficina.
- **Rediseño:** recorrida visual con Liquidador/Admin de los tableros de análisis, resumen y analytics.

## A futuro

Por prioridad de la auditoría del 2026-09-28 y la de seguridad del 2026-10-01:

- **Backups automáticos de `Horas_Sertec` (prioridad 1):** pospuesto por el usuario el 2026-10-05; no traerlo como
  en curso ni pendiente hasta que lo pida. Quedó en la entrevista, pregunta 1 (destino externo). Ya se le explicó qué
  es; no repetirlo. Enfoque aceptado: dump nocturno con transacción → `zstd` → `gpg` simétrico con frase larga →
  copia local 14 días + Google Drive con `rclone` (90 días + una mensual por un año) → restore probado en `testing` →
  procedimiento escrito sin la clave. VPS: falta `mariadb-client` y `rclone`; hay `gpg`, `zstd`, `rsync`, 90 GB
  libres. La base pesa 14,6 MB; los adjuntos, 11 MB.

- **Credenciales (prioridad 2):** alta masiva y reset usan el CUIL como contraseña, sin cambio forzado al primer
  ingreso ni límite de intentos. Juntarlo con el login de abajo.
- **Login de la app:** se alcanza saltando Cloudflare (HTTPS directo a la IP) y nginx ve IPs de Cloudflare, no las
  reales. Arreglo: `real_ip` de Cloudflare, limitar 80/443 a sus rangos, `limit_req` y `@nestjs/throttler`.
- **DDL a mano en dos bases (prioridad 3):** migrar a Prisma Migrate de a poco, empezando por el próximo cambio de
  esquema. Pendiente puntual: `DROP COLUMN modalidad_pago` (§87).
- **Sesión (prioridad 4):** JWT de 1 h sin refresh, en localStorage, con el rol dentro del token.
- **`registros-horas.service.ts` (prioridad 5):** 1313 líneas; separar los 6 métodos de paneles a
  `paneles.service.ts` recién cuando toque un panel. Ya se le explicó al usuario que es mecánico; no reabrirlo.
- **Menores:** `estado` sin validar en el listado de registros (500 en vez de 400); CORS abierto; `.env` del backend
  en 644 (debería ser 600); `server_tokens off` en nginx; GET `/empleados` visible para todo rol; paginación.
- **Portal de certificaciones apagado (§84):** rotar `AZURE_CLIENT_SECRET`, `OPENAI_API_KEY` y `HORAS_JWT_SECRET`;
  borrar vistas de compatibilidad y la tabla `usuarios` en `Horas_Sertec`; limpiar `testing`; archivar el repo.
  Irreversible: pedir OK por cada paso.
- **Deuda de Baja de Operario:** 9 minor de la revisión de #105/#88 (§103, comentario en los PRs). Los más
  relevantes: alta de baja sin transacción ni índice único, bajas confirmadas en las pestañas
  Justificadas/Injustificadas de `/ausencias`, conteo de bajas sin confirmar distinto entre front y back con
  administrativos.
- **Deuda de Frontend:** minors de #84-#86 (§96-§98); `session.tsx` deja guardado el token si falla `fetchPerfil`.
- **Codex como tercer revisor:** idea conversada (usa el plan ChatGPT del usuario vía Codex CLI, solo lectura, en la
  fase 4 de `flujo-sertec`). No arrancó: falta que el usuario lo pida.
