# prisma/migrations — estado y advertencias

## Estado actual

Esta carpeta contiene la **primera migración jamás trackeada** de este repo
(`20260831192740_certificaciones_accesos`). El proyecto nunca usó
`prisma migrate` antes de esto: la BD compartida ya tiene ~30 tablas creadas
por fuera de Prisma Migrate (sin historial en `_prisma_migrations`), y ese
schema existente **no tiene baseline**.

La migración `20260831192740_certificaciones_accesos` fue generada sin
conectarse a ninguna base de datos (con
`prisma migrate diff --from-empty --to-schema`, que solo analiza el schema
local) y solo agrega las dos tablas nuevas del módulo Certificaciones
(`sth_certificaciones_accesos`, `sth_certificaciones_contratos`). Queda
**pendiente de aplicar**.

## ⚠️ Qué NO hacer

**NUNCA correr `prisma migrate dev` ni `prisma db push` contra la BD
compartida mientras no haya baseline.** Como las ~30 tablas preexistentes no
figuran en el historial de migraciones, Prisma va a detectar drift masivo al
compararlas contra un historial vacío y va a **proponer resetear la base**
(borrar todo) para "resolver" ese drift. Eso destruiría datos de producción/
compartidos.

Esto aplica tanto en local (si el `.env` apunta a la BD compartida) como en
cualquier pipeline: el único comando seguro contra esa BD, hasta que se
baseline, es `prisma migrate deploy`.

## Cómo aplicar esta migración

En el deploy, contra la BD real:

```bash
npx prisma migrate deploy
```

`migrate deploy` no calcula drift ni propone resets: solo aplica migraciones
pendientes en orden. Como el historial está vacío, va a intentar aplicar
únicamente esta migración (crea las 2 tablas nuevas; no toca nada existente).
Debería aplicar limpio siempre que `sth_usuarios` y `sth_contratos` ya
existan en esa BD (existen).

## Camino correcto si algún día se quiere baseline

Si en el futuro se decide adoptar `prisma migrate dev` de forma normal contra
la BD compartida, primero hay que baselinear el schema preexistente (marcar
como "ya aplicadas" las migraciones que representan el estado actual, sin
volver a ejecutarlas). El mecanismo es:

```bash
npx prisma migrate resolve --applied <nombre_de_la_migracion_de_baseline>
```

Eso requiere antes generar una (o más) migración(es) que reproduzcan el
schema actual completo (típicamente con
`prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma`
o el flag vigente en la versión de Prisma en uso, contra el schema previo a
este cambio) y marcarla(s) como aplicada(s) con `migrate resolve --applied`
en cada entorno, **antes** de que alguien corra `migrate dev` ahí. Esta
tarea toca la BD (aunque sea solo para escribir en `_prisma_migrations`) y
por eso no se hizo en este task — queda para cuando el usuario decida
encararla, idealmente coordinado con el deploy.
