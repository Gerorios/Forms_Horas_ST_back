# 2026-09-23 — Tarjeta corregida con el estado real de la corrección

Carril corto (1 archivo de código en el Frontend, sin DDL, sin cambio de API).
Aprobado por el usuario: "dale, seguí con el 1 y el 2".

## Diagnóstico

Cristian Urueña, Mis registros, 18/09: original 13.5 hs `desaprobado` (id 2988)
+ corrección 10.5 hs (id 3039, `lote_id_origen` = lote de la 2988) también
`desaprobado` ("fecha mal informada"). `TarjetaCorregida` pintaba
`<StatusBadge estado="aprobado" />` fijo → el operario veía "Aprobado" con total
0 hs (el total es correcto: suma solo `aprobado`).

## Pasos — Frontend, rama `fix/badge-correccion`

1. `registros-cards.tsx`: `<StatusBadge estado={corregida.estado} />`.
2. Borde y línea "Corregido de X a Y" en verde solo si `corregida.estado === 'aprobado'`;
   si no, `border-line` / `text-slate`.
3. Tests en `registros-cards.test.tsx`: caso Urueña (visto fallar sin el
   arreglo) + pendiente en gris / aprobada en verde.

Necesita deploy del Frontend (solo si el usuario lo pide).

## Paso 4 (agregado tras la revisión, OK del usuario "dale, la 1")

Deuda que marcó el verificador: con la corrección rechazada solo se veía el
motivo del rechazo ORIGINAL. Se agrega, en `text-danger`, "Corrección
rechazada: <motivo>" cuando `corregida.estado === 'desaprobado'` y hay motivo.
Test en el caso Urueña (visto fallar sin el cambio).

Revisión: 2 ejes → verificador 0 urgent / 0 high / 3 minor (tests: dos
escenarios en un `it`, aserción débil en Urueña, borde sin test) / 3 descartados.
