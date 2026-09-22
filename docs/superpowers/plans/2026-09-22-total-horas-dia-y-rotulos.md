# 2026-09-22 — totalHorasDia redondeado y rótulos de horas

Carril corto (decisión cerrada, ≤3 archivos de código por repo, sin DDL, sin cambio de API).

## A · Backend — rama `fix/total-horas-dia-redondeo`

- `src/registros-horas/registros-horas.service.ts` (`porAprobar`): `totalHorasDia`
  pasa a `Math.round(x * 100) / 100`, como los otros 5 totales del servicio.
- Test rojo en `registros-horas.service.spec.ts`: filas del día 0.1/0.2/0.3 → 0.6
  (sin el arreglo da 0.6000000000000001). Visto fallar.
- Necesita deploy del Backend.

## B · Frontend — rama `fix/rotulos-horas`

- Inicio (`app/(protected)/page.tsx`): tile "Horas cargadas" con
  `sub: 'Incluye pendientes de aprobación'` (`DatoIndicador` gana `sub?: string`).
- `registros-cards.tsx`: tarjeta grande "Total Nª quincena" → "Horas aprobadas · Nª quincena".
- `cargas-agrupadas.tsx`: mantiene "Total Nª quincena" + línea "Incluye pendientes de aprobación".
- Solo textos. Tests rojos en los tres test files. Necesita deploy del Frontend.

## Fuera de alcance

- (C) Cristian Urueña 0 hs / 10.5 aprobadas: sin diagnosticar, va aparte.

## Nota

El 2026-09-22 el reinicio de Claude Code borró el worktree Backend sin commitear;
A se rehízo en `.claude/worktrees/total-horas-dia` (test rojo visto de nuevo).
