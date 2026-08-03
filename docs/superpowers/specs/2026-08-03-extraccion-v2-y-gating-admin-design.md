# Extracción de tickets v2 + gating Admin-only del módulo combustible — Diseño

**Fecha:** 2026-08-03 · **Estado:** aprobado en conversación (usuario pidió "aplica esos cambios")
**Repos:** Backend y Frontend, rama `feature/modulo-combustible` (el sidebar plegable se mergea antes a esta rama en Frontend).

## Contexto

El usuario reescribió el PROMPT de `extraccion-ticket.service.ts`: ahora el modelo devuelve
campos nuevos (`tipoComprobante`, `puntoVenta`, `numero`, `lineaOrigenNumero`,
`confianzaNumero`, `precioLitro`, `cuitEstacion`, `cae`) que el backend hoy ignora. Además,
hasta afinar el módulo, combustible debe quedar **visible y usable SOLO por Admin** antes de
mergear a main (restricción temporal, revertible).

## Parte A — Aprovechar los campos nuevos de la extracción

`ExtraccionTicket.sugerencias` se amplía con:

- `tipoComprobante: 'REMITO'|'FACTURA_A'|'FACTURA_B'|'FACTURA_C'|'TIQUE'|'OTRO'|null` — tal
  cual del modelo, null si falta o no matchea esos literales.
- `medioPagoSugerido: 'cuenta_corriente'|'caja'|null` — **derivado en el backend** (regla de
  negocio ADR-013): REMITO→`cuenta_corriente`; FACTURA_A/B/C o TIQUE→`caja`; OTRO/null→null.
- `confianzaNumero: 'alta'|'media'|'baja'|null` — passthrough validado contra esos literales.
- `lineaOrigenNumero: string|null` — passthrough (truncar a 200 chars por sanidad).
- `precioLitro: number|null` — passthrough si es number.
- `advertenciaCoherencia: string|null` — **calculada en el backend** (no confiar en la
  auto-corrección del modelo): si litros, precioLitro y monto son números y
  `|litros×precioLitro − monto| / monto > 0.05`, mensaje
  `"Litros × precio unitario (X) no coincide con el total (Y)."` con X e Y formateados a 2
  decimales. Si falta alguno de los tres, null.

Ajuste menor: `max_tokens` del path Anthropic 512→1024 (el JSON de salida creció; OpenAI ya
está en 2048).

### Frontend (form "nueva carga")

- **Medio de pago:** si viene `medioPagoSugerido` y el usuario no tocó el campo, se
  pre-selecciona. Si el usuario elige lo contrario a la sugerencia, aviso blando (no bloquea):
  "La foto parece un remito (cuenta corriente)" / "La foto parece una factura/tique (caja)".
- **Confianza del comprobante:** junto al badge de sugerencia del nro. de comprobante, chip de
  confianza (alta=verde, media=ámbar, baja=rojo) y debajo, en texto chico, `lineaOrigenNumero`
  ("Leído de: «REMITO : R 0021 - 00059874»") para verificar sin abrir la foto.
- **Coherencia:** si `advertenciaCoherencia` no es null, aviso blando bajo el campo monto.
- Todo es sugerencia: nada bloquea el submit (mismo criterio ADR-013: la IA solo sugiere).

## Parte B — Gating temporal Admin-only

- **Backend:** las 8 rutas de `cargas-combustible.controller.ts` pasan a `@Roles('Admin')`.
  Los catálogos de solo-lectura `/catalogos/estaciones-servicio` y `/catalogos/tipos-combustible`
  quedan como están (los usa el form, y Admin es quien lo ve; no exponen nada sensible).
- **Frontend:** en `nav.ts`, ítem `/combustible` → `roles: ['Admin']` (esto también cierra
  `canAccess` de guards). Comentario `// TEMPORAL hasta afinar el módulo (ver spec 2026-08-03)`.
- **Reversión futura:** restaurar los decoradores y el array de roles (queda documentado acá;
  los valores originales: POST/extraer/ultimo-km/PATCH×2 = JefeCuadrilla+Admin; GET×3 =
  JefeCuadrilla+JefeContrato+Admin; nav = JefeCuadrilla+JefeContrato+Admin).

## Fuera de alcance

- `cae`/`cuitEstacion` (sin caso de uso todavía), alias de tipos de combustible para el match
  contra catálogo, persistir metadata de extracción en BD.

## Testing

- Backend: unit tests de derivación de `medioPagoSugerido`, validación de literales de
  confianza, y `advertenciaCoherencia` (cierra / no cierra / faltan datos). Tests de roles del
  controller si existen; si no, al menos verificar decoradores en test de metadata Reflect.
- Frontend: tests del form (preselección de medio de pago, aviso por contradicción, chip de
  confianza, aviso de coherencia) y de nav (solo Admin ve /combustible).
