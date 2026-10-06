# Revisión de Baja de Operario (ADR-026) — arreglos

PRs: Gerorios/Forms_Horas_ST_back#105 y Gerorios/Forms_Horas_ST_Frontend#88 (rama
`feature/baja-de-operario`). El PR llegó escrito; este plan registra solo los
arreglos que salieron de la revisión (revisores Standards + Spec →
`verificador-review`): 1 urgent, 1 high, 9 minor sin tocar.

## Paso R1 (urgent) — no congelar la fecha de una baja sin confirmar

- **Hallazgo:** `cierres.service.ts` congela `fechaBaja` también cuando
  `estadoBaja = 'sin_confirmar'`, y el Excel la escribe en la columna FECHA BAJA.
- **Falla:** un supervisor informa la baja de un fijo el 05/10, HyS no la
  confirma; el Excel de pago sale con FECHA BAJA 05/10 y el liquidador de
  sueldos prorratea el sueldo de alguien que sigue trabajando. Contradice
  CONTEXT ("Informada … no tiene ningún efecto") y ADR-026 §2.
- **Arreglo:** en `cierres.service.ts`, congelar `fechaBaja` solo si
  `estadoBaja` es `'previa'` o `'en_quincena'`. `estadoBaja` se sigue congelando
  (la salvedad de bajas sin confirmar no cambia). La preliquidación en pantalla
  no se toca: ahí la pendiente se muestra a propósito ("Baja s/conf.").
- **Test:** en `cierres.service.spec.ts`, una fila `sin_confirmar` con fecha →
  el detalle congelado tiene `fechaBaja: null`.

## Paso R2 (high) — reabrir una baja respeta "una sola vigente"

- **Hallazgo:** `novedades.service.ts` `reabrir()` no pasa por
  `verificarBajaUnica`.
- **Falla:** HyS rechaza una baja con fecha mal, se carga y confirma otra con
  la fecha buena; alguien reabre la rechazada → dos bajas vigentes. Si se
  confirma también, gana la de fecha más temprana y se bloquean días
  trabajados.
- **Arreglo:** en `reabrir`, si el tipo de la novedad es Baja de Operario,
  llamar a `verificarBajaUnica(novedad.operarioCuil, id)` antes de actualizar.
- **Test:** en `novedades.service.spec.ts`, reabrir una baja rechazada cuando
  ya hay otra vigente → `BadRequestException` y no actualiza.

## Minor (no se tocan; se listan en el PR)

Ver el comentario de revisión en los PRs.
