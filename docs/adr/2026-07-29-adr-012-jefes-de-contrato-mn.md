# ADR-012: Jefes de Contrato M:N

## Contexto

Hasta ahora un `Contrato` tenía **un solo** Jefe de Contrato:
`sth_contratos.jefe_contrato_cuil`, columna FK nullable 1:N (`Usuario 1 —
N Contrato`, relación `"JefeContrato"` en el schema).

Asignar un contrato a un Jefe se lo **"robaba" en silencio** al Jefe anterior:
tanto `POST /admin/usuarios` / `PATCH /admin/usuarios/:cuil`
(`contratosJefeIds`) como cualquier alta futura de "editar contrato" con un
campo `jefeContratoCuil` hacían un `update`/`updateMany` que sobreescribía la
columna, sin aviso a nadie. Esto ya estaba documentado como comportamiento
conocido en `admin.service.ts` (`updateUsuario`), pero era una limitación real
del negocio: en la práctica más de una persona necesita poder aprobar las
horas de un mismo contrato (cobertura por vacaciones, contratos grandes con
más de un responsable, etc.), y el modelo 1:N no lo permitía sin pisar al
titular anterior.

## Decisión

1. Se modela la relación como **M:N** vía la tabla `sth_contratos_jefes`
   (`contrato_id`, `usuario_cuil`, PK compuesta, FKs a `sth_contratos` y
   `sth_usuarios`) — mismo patrón que `sth_contratos_habilitados`
   (`ContratoHabilitado`). En Prisma: modelo nuevo `ContratoJefe`.
2. **Cualquiera de los jefes de un contrato puede resolver** sus registros:
   aprobar, desaprobar, reabrir o corregir. No hay doble aprobación ni orden
   de prioridad — el primero que actúa resuelve para todos los demás. Quién
   fue puntualmente ya queda registrado en `RegistroHoras.aprobadoPorCuil`
   (sin cambios), así que no se pierde trazabilidad.
3. El chequeo de permiso "¿sos jefe de este contrato (o Admin)?" pasa de
   comparar `contrato.jefeContratoCuil === cuil` a
   `contrato.jefes.some(j => j.usuarioCuil === cuil)` (o el `where` Prisma
   equivalente `{ jefes: { some: { usuarioCuil: cuil } } }`) en
   `registros-horas.service.ts`: `resolver`, `reabrir`, `resolverLote`,
   `corregirLote` y `porAprobar`.
4. Contrato de API:
   - `GET /admin/contratos` devuelve `jefesCuils: string[]` por contrato (en
     vez de `jefeContratoCuil`/`jefeContrato`).
   - `PATCH /admin/contratos/:id` acepta `jefesCuils?: string[]`: reemplaza el
     set **completo** de jefes de ESE contrato (`deleteMany` + `createMany`).
     `[]` lo deja sin jefes; `undefined` no toca la relación.
   - `POST /admin/usuarios` y `PATCH /admin/usuarios/:cuil` mantienen
     `contratosJefeIds?: number[]` sin cambio de forma, pero ahora con
     semántica de set completo **del usuario** vía `ContratoJefe`
     (`deleteMany` por `usuarioCuil` + `createMany`), sin tocar las filas de
     otros jefes de esos mismos contratos.
   - `GET /admin/usuarios` mantiene `contratosComoJefe: { id, codigo }[]`, ahora
     derivado de `ContratoJefe` en vez de la relación 1:N directa.
5. **Migración de datos**: ya ejecutada fuera de este cambio de código. La
   tabla `sth_contratos_jefes` ya existe en la base y ya tiene las 8 filas
   backfilleadas desde `sth_contratos.jefe_contrato_cuil`.
6. **La columna vieja `sth_contratos.jefe_contrato_cuil` NO se dropea
   todavía.** Prisma deja de modelarla (se saca del `schema.prisma`), pero
   sigue existiendo físicamente en la base porque el código de producción
   (previo a este deploy) todavía la lee. El `DROP COLUMN` queda **diferido
   a después de que este código llegue a producción** — es un paso
   pendiente explícito, no un olvido. Hasta ese momento, la columna vieja
   queda "congelada" (nadie la escribe desde el código nuevo) y sin uso real.

## Consecuencias

- Un mismo registro puede ser resuelto por cualquiera de N jefes; no hay
  noción de "que decidan entre ellos" a nivel de sistema — es una decisión de
  producto explícita (ver alternativas descartadas).
- El admin panel de "editar contrato" pasa de un selector único de Jefe a un
  multi-select de jefes.
- Pendiente post-deploy: `ALTER TABLE sth_contratos DROP COLUMN
  jefe_contrato_cuil` (y su FK), una vez confirmado que no queda código en
  producción leyéndola.

## Alternativas consideradas

- **Mantener jefe único + aviso en la UI al reasignar** — descartada: no
  resuelve el caso real de negocio (más de una persona con responsabilidad
  simultánea sobre el mismo contrato), solo hace más visible el problema
  existente.
- **Doble aprobación (requiere que N jefes aprueben para que el registro
  quede aprobado)** — descartada por el dueño del producto: agrega fricción
  operativa sin un beneficio claro para este dominio; el objetivo era dar
  cobertura/redundancia entre jefes, no un control de cuatro ojos.
