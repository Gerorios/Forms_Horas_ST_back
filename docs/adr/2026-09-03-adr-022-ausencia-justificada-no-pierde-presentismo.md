# ADR-022 — Ausencia justificada: HyS decide si pierde presentismo (excepción al "cualquier ausencia lo pierde")

**Fecha:** 2026-09-03
**Estado:** Aceptado
**Afecta:** `prisma/schema.prisma` (`Novedad.pierdePresentismoHys`, DDL manual),
`src/novedades/dto/resolver-novedad.dto.ts`, `src/novedades/novedades.service.ts`,
`src/liquidacion/calculo.service.ts`, `src/liquidacion/panel.service.ts`,
frontend (`ResolverDialog` en `/ausencias`, `DetalleNovedadDialog`).

## Contexto

ADR previo (sin número propio, ver contexto-proyecto.md sección 61, 2026-08-19):
"cualquier Ausencia hace perder el presentismo — justificada, injustificada o
aún pendiente", confirmado explícitamente por el dueño de producto ("si la
persona faltó pierde el presentismo, no importa el certificado").

Una investigación posterior encontró casos reales donde una Ausencia
**justificada** por HyS no debería hacer perder el presentismo (ej. licencia
especial por paternidad) — a diferencia de una enfermedad común, que sí lo
hace perder aunque esté justificada con certificado válido. La distinción no
depende de si el certificado es válido (eso ya lo resuelve `estadoHys`), sino
del **motivo** de la ausencia, que hoy no está estructurado en el sistema
(`justificacionTexto` es texto libre).

## Decisión

- Nuevo campo `Novedad.pierdePresentismoHys: Boolean?` (nullable).
- Se completa **únicamente** cuando HyS resuelve una Ausencia como
  `aprobada` (justificada) — es una decisión manual, caso por caso, sin
  catálogo de motivos ni valor por defecto: el botón "Justificar" queda
  deshabilitado hasta que HyS elige explícitamente Sí/No.
- Para `desaprobada` (injustificada) y `pendiente`, la regla vieja no
  cambia: siempre pierde presentismo, sin excepción. El campo queda `null`
  en esos casos — `calculo.service.ts` no lo lee ahí.
- El motivo de la decisión (ej. "no pierde presentismo por licencia
  especial") se escribe en el campo `descargoHys` ya existente — no se creó
  un campo de texto nuevo para esto.
- Al reabrir una novedad, `pierdePresentismoHys` vuelve a `null` junto con
  el resto de la resolución (mismo criterio que `estadoHys`, `descargoHys`,
  etc.).
- Se agrega auditoría a `resolverHys()` (antes no la tenía, a diferencia de
  `anular`/`reabrir`): dos filas de `Auditoria` cuando aplica (una para el
  cambio de `estadoHys`, otra para `pierdePresentismoHys`), en la misma
  transacción que el update.

### Datos históricos

Las Ausencias justificadas resueltas **antes** de este cambio se backfillean
a `pierdePresentismoHys = true` — preserva el cálculo ya hecho en
liquidaciones cerradas/versionadas, sin recomputar nada retroactivamente.

**Excepción puntual**: 3 operarios de la última quincena, ajustados a mano
al momento de liquidar sueldos porque no debían perder presentismo. Esos
casos se corrigen con el flujo existente (`reabrir` → volver a `Justificar`
marcando `pierdePresentismoHys = false`), no con un backfill especial ni una
pantalla nueva.

## Alternativas consideradas

- **Catálogo estructurado de motivos de ausencia** (ej. "Accidente
  laboral/ART", "Fallecimiento familiar", "Licencia especial", "Enfermedad"),
  cada uno con su efecto sobre presentismo predefinido. Más alineado a cómo
  funciona esto en la práctica (hay causales protegidas por ley), pero es un
  salto de alcance mucho mayor — hoy no existe ningún campo estructurado de
  motivo, solo texto libre. Se descarta para esta iteración; queda como
  camino futuro si el criterio manual resulta insuficiente o inconsistente
  entre distintas personas de HyS.
- **Desglosar el resumen de ausencias (export CSV)** por pierde/no pierde
  presentismo. Descartado: el dueño de producto aclaró que ese cruce ya se
  ve en el panel de liquidación al armar/cerrar la quincena, y duplicarlo en
  el resumen no aporta.

## Consecuencias / notas

- Requiere DDL manual (nueva columna nullable en `sth_novedades`) en las dos
  bases — `docs/sql/2026-09-03-pierde-presentismo-hys.sql`. Al ser nullable
  y sin default forzado por la app (la app decide cuándo exigirlo), no
  rompe filas existentes ni requiere backfill a nivel de DDL — el backfill
  a `true` de las Ausencias `aprobada` históricas se hace aparte (ver
  script en el mismo archivo).
- `panel.service.ts` deja de mostrar siempre "pierde presentismo" para toda
  Ausencia en el drill-down del Liquidador — ahora refleja la decisión real
  por novedad ("no pierde presentismo (justificada)" cuando corresponda).
- Esto es una **reversión parcial** de una decisión de negocio confirmada
  el mes anterior, no una funcionalidad nueva sin precedente — documentado
  acá para que quede claro por qué el comportamiento de 2026-08-18/19 ya no
  es el vigente para el caso "justificada".
