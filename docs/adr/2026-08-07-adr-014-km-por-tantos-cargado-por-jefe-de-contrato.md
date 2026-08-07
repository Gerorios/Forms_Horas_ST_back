# ADR-014 — Km "por tantos" cargado por Jefe de Contrato, habilitado por usuario

**Fecha:** 2026-08-07
**Estado:** Aceptado (diseño cerrado, implementación pendiente)
**Afecta:** `sth_km_por_tantos`, `sth_usuarios` (columna nueva), `POST`/`GET
/liquidacion/quincena/km-por-tantos`, pantalla nueva del JefeContrato, nav
lateral, Admin > Usuarios, `/liquidacion/quincena/detalle` (fila del
Liquidador pasa a solo lectura para "por tantos").

## Contexto

El régimen `por_tantos` (relevamiento de fugas, medido en km — ver ADR-009 y
ADR-011) asumía que el km se mide en una app externa y que el Liquidador lo
carga a mano por quincena. En la práctica esa fuente externa no está
disponible: el dueño de producto no tiene ese input. Pidió que sea el Jefe de
Contrato (JdC) quien cargue el total de km ejecutados al cierre de la
quincena — está más cerca de la operación real — y que el Liquidador vea el
resultado ya traducido a horas equivalentes, sin tener que cargarlo él mismo.

## Decisión

- **Quién escribe:** JefeContrato (habilitado, ver abajo) y Admin. El
  Liquidador pierde la escritura que tenía hoy sobre este dato — pasa a ser
  100% lectura en todo lo referido a "por tantos" (ve km + horas
  equivalentes ya calculadas, ninguna editable).
- **Pantalla nueva y separada** para el JdC ("Km por tantos"): selector
  año/mes/quincena + tabla de **todos** los relevadores activos (nombre +
  cuil + km), guardado en bloque. No filtra por contrato: no existe (ni se
  crea) un vínculo relevador↔contrato en el modelo, así que un JdC
  habilitado ve a todos los relevadores, no solo a "los suyos".
- **Habilitación por usuario, no automática por rol:** se agrega
  `Usuario.puedeCargarKmPorTantos` (booleano, default `false`), que el Admin
  prende desde Admin > Usuarios. El rol `JefeContrato` por sí solo no da
  acceso a la pantalla ni al endpoint de escritura — mismo criterio ya usado
  en ADR-007 para el rollout selectivo de una funcionalidad a un subconjunto
  de usuarios de un rol. Hoy solo tendría sentido habilitarlo para el/los
  JdC de K5 (los únicos con relevadores), pero se modela como permiso de
  usuario, no como propiedad del contrato.
- **Auditoría:** cada carga/corrección de km (JdC o Admin) queda registrada
  en `sth_auditoria` (quién, cuándo, valor anterior → nuevo) — a diferencia
  de otras cargas del Liquidador en este módulo, que hoy no la tienen. Se
  suma acá porque el dato pasa a ser escrito por un rol nuevo y alimenta
  directamente el cálculo de sueldo.
- **Datos expuestos al JdC:** solo nombre + cuil + km cargado. Nada de
  categoría UOCRA, tarifa ni ningún dato de pago — esos siguen siendo
  exclusivos de Admin/Liquidador.

## Alternativas consideradas

- **Gatear el panel reusando `ContratoHabilitado`** (si el JdC tiene K5
  habilitado, ve el panel). Descartado: mezclaría dos significados
  distintos — qué contratos puede cargar horas, vs. quién ve este panel — y
  hubiera requerido inventar el vínculo relevador↔contrato que se decidió
  explícitamente no modelar.
- **Visible a los 3 Jefes de Contrato sin restricción**, sin ningún flag
  nuevo. Más simple de construir, pero un JdC ajeno a los relevadores podría
  cargar km por error sin entender el alcance. El toggle de Admin cuesta
  poco (mismo patrón ya construido en ADR-007) y evita ese riesgo.
- **El Liquidador conserva la edición como respaldo.** Descartado
  explícitamente por el dueño de producto: quiere una sola fuente de verdad
  para este dato (el JdC), con Admin como única vía de escape.

## Consecuencias / notas

- Migración manual (BD compartida, nunca `prisma migrate`/`db push`):
  columna `puede_cargar_km_por_tantos BOOLEAN NOT NULL DEFAULT false` en
  `sth_usuarios`.
- El controller `LiquidacionController` tiene hoy `@Roles('Admin',
  'Liquidador')` a nivel de clase. El `POST
  /liquidacion/quincena/km-por-tantos` necesita bajar a nivel de método con
  sus propios roles (`Admin`, `JefeContrato`) + validación del flag para
  `JefeContrato` en el service (403 si no está habilitado) — no alcanza con
  el guard de roles solo. El `GET` correspondiente suma `JefeContrato` (para
  prellenar su propia pantalla) sin sacarle la lectura a `Liquidador`.
- El nav lateral debe mostrar "Km por tantos" a un JefeContrato únicamente
  si `puedeCargarKmPorTantos = true` — igual criterio que "Novedades" para
  JefeCuadrilla en ADR-007 (el rol solo no alcanza, hace falta el permiso).
