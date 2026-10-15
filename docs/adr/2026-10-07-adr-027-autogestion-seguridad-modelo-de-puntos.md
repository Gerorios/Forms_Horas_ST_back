# ADR-027 — Autogestión de la Seguridad: un solo reporte, la inspección como tipo y los puntos como movimientos

**Fecha:** 2026-10-07
**Estado:** Propuesto, revisado el 2026-10-08 tras la primera prueba con HyS
**Afecta:** módulo nuevo; tablas `sth_seg_*` (DDL manual en `docs/sql/`), sin
tocar tablas existentes.

## Contexto

HyS pidió un módulo, abierto a todos los usuarios sin importar el rol, para
medir de forma individual la actitud ante la seguridad. Funciona con puntos que
se suman y se restan:

- Cualquier persona sube **reportes de seguridad** (aviso de riesgo, incidente,
  paralización de trabajos, propuesta de mejora). Si HyS aprueba uno, le pone
  de 0 a 10 puntos a su autor. La aprobación depende de lo que se gestionó en
  campo: un reporte completo sin gestión se desaprueba y vale 0.
- En sus salidas de campo, HyS registra **inspecciones de seguridad** que les
  **restan** de 0 a 10 puntos a las personas observadas. No tienen relación
  con los reportes de esas personas: alguien que nunca reportó nada puede
  terminar con puntaje negativo.
- HyS define los períodos (en principio, semestrales) y arma un ranking.

Vocabulario en `CONTEXT.md`, sección "Autogestión de la Seguridad".

## Decisión

1. **La inspección es un tipo de reporte, no un registro aparte.** Usa el
   mismo formulario y el mismo circuito (pendiente → HyS la aprueba con el
   puntaje). Solo el rol HyS la ve en el selector. La diferencia está en a
   quién van los puntos: en los demás tipos suma el **autor**; en la
   inspección restan los **involucrados**, y HyS, como autora, no suma.
2. **Los tipos son una lista fija en el código (enum), no un catálogo.** Cada
   tipo pide campos y reglas distintas (naturaleza, motivo de paralización,
   control del riesgo), así que sumar un tipo siempre es desarrollo.
3. **Los puntos son movimientos derivados y nunca se guarda un total.** Cada
   aprobación genera una fila por persona en `sth_seg_movimientos_puntos`, con
   signo; recalificar la actualiza, y reabrir o desaprobar la borra. Solo el
   sistema escribe en esa tabla. El puntaje de un período es la suma de los
   movimientos de esa persona.
4. **El período lo decide la fecha del reporte** (cuando pasó), no la de
   aprobación. Por eso el ranking de un período puede cambiar mientras HyS
   siga aprobando reportes atrasados: los períodos no se congelan.

5. **El punto en el mapa sale de las fotos, no del envío.** Cada foto
   sacada con la cámara desde la app (dos botones, "Sacar foto" y "Elegir de
   galería", más un control de que el archivo es de hace pocos minutos)
   guarda latitud, longitud y error; las de galería no guardan ubicación. El
   punto del reporte es el de la foto de cámara con menor error. El autor no
   declara nada. El mapa de calor y la lectura de metadatos de las fotos de
   galería quedan para más adelante: suman dependencias nuevas al frontend
   (`leaflet`, `exifr`), y el usuario prefirió no sumarlas todavía. Los
   puntos se guardan igual desde el principio, así que el mapa tendrá
   historia cuando se agregue.

## Alternativas descartadas

- **Descuento como registro propio de HyS**, con campos y circuito separados.
  Se descartó cuando HyS aclaró que registra "exactamente igual" que los
  demás: habría dos formularios, dos bandejas y tableros que juntan dos
  tablas para contestar lo mismo ("¿qué riesgos hay por naturaleza o por
  contrato?").
- **Una tabla de puntaje por operario.** Un total guardado se desincroniza
  cuando HyS recalifica o reabre, y además obliga a fijar de antemano la
  unidad de tiempo. Con movimientos, cualquier rango de fechas es una suma, y
  cada punto se rastrea hasta el reporte del que viene.
- **Calcular el ranking en el momento, sin tabla de movimientos** (sumar los
  reportes aprobados más los involucrados de las inspecciones). Se puede,
  pero dispersa la regla de "quién recibe cuánto" en cada consulta. La tabla
  de movimientos la deja escrita en un solo lugar: el código que aprueba.
- **Período por fecha de aprobación.** Así los meses cerrados no cambiarían,
  pero los puntos caerían en un período distinto al de lo que la persona hizo,
  según cuánto tarde HyS en aprobar.

- **Tomar el GPS al enviar el reporte.** Es lo más simple, pero quien
  reporta a la noche desde su casa lo que vio a la mañana pone el punto en su
  casa, y el mapa de calor termina mostrando dónde vive la gente.
- **Preguntarle al autor "¿estás en el lugar?"**: funciona, pero es una
  pregunta más para el operario, y la foto de cámara contesta lo mismo sin
  preguntar.
- **"Riesgo controlado: sí/no" declarado por el autor**: se descartó a pedido
  de HyS. Si la gestión alcanzó lo juzga HyS al aprobar, así que la alarma
  del panel queda solo para las paralizaciones pendientes.

## Consecuencias

- Cualquier cambio en la calificación tiene que pasar por el servicio que
  mantiene los movimientos. Un `UPDATE` a mano sobre `sth_seg_reportes` deja
  el ranking desfasado.
- Antes de anunciar ganadores, HyS tiene que aprobar todo lo pendiente del
  período. El panel avisa cuántos pendientes quedan.
- Habrá menos puntos que reportes: las fotos son opcionales y las de
  galería no dan punto. La foto se achica en el celular antes de subir y no
  conserva sus metadatos.
- La ubicación de un empleado es un dato personal (Ley 25.326). Ninguna web
  puede saltear el permiso del navegador, que se pide una vez; la
  capacitación tiene que aclarar que la app solo toma la ubicación al sacar
  la foto de un reporte, nunca después.
- Quedan abiertos, a la espera de HyS: si *accidente* y *tolerancia 0* son
  tipos (y qué campos piden), y la competencia por grupos de trabajo (no
  existe un dato confiable de cuadrilla, ver ADR-001).

## Revisión 2026-10-08 (primera prueba con HyS)

Cambia cuatro decisiones de arriba:

- **Sin períodos guardados (reemplaza la 4).** HyS no quiso administrar
  períodos: cada uno consulta puntos, ranking y tableros por un rango de
  fechas libre (atajos mes, trimestre, semestre, año), con el año en curso por
  defecto. Se borra `sth_seg_periodos`. Sigue valiendo que manda la **fecha
  del reporte**.
- **Punto GPS propio del reporte (amplía la 5).** Para saber de qué obra se
  trata una paralización hace falta el punto aunque no haya foto: el autor lo
  toma con un botón ("Tomar mi ubicación") y queda en el reporte
  (`latitud`, `longitud`, `error_metros`). Es obligatorio en la paralización
  y opcional en el resto; si falta, sigue valiendo la foto de cámara con
  menor error. Sin mapa para corregir el pin: sumaba una librería (Leaflet), y
  al aire libre el GPS da 5–15 m, que alcanza para identificar la obra.
- **HyS corrige reportes ajenos, en cualquier estado.** Antes HyS solo
  calificaba y nunca editaba lo que el autor declaró. En la práctica los
  operarios confunden tipos (un aviso que es una propuesta), y que HyS lo
  reabra para que el autor lo corrija era demasiado circuito. Si el reporte
  estaba aprobado, los movimientos se recalculan en la misma transacción (un
  cambio de tipo a inspección, o de involucrados, mueve puntos). La auditoría
  guarda el antes y el después.
- **Inspectores habilitados por persona.** Además de HyS, pueden cargar
  inspecciones los usuarios que HyS habilite uno por uno (hoy, algunos
  supervisores). Se guarda en una tabla propia del módulo
  (`sth_seg_inspectores`) y no como columna de `sth_usuarios`, para no tocar
  la tabla de acceso compartida. Se descartó habilitar roles enteros: no sirve
  para "este supervisor sí y aquel no".

## Revisión 2026-10-15 (punto marcado en el mapa)

Cambia el "sin mapa para corregir el pin" de la revisión anterior:

- **El punto también se marca en el mapa.** Lo que importa es dónde pasó, no
  dónde está quien reporta: quien carga a la noche lo que vio a la mañana, o
  está bajo techo sin señal, igual sabe el lugar. Al crear el reporte, al
  lado de "Tomar mi ubicación" está "Marcarla en el mapa" (Leaflet +
  OpenStreetMap, con búsqueda de direcciones en Nominatim; todo gratuito, sin
  claves). El mapa arranca en la capital de la provincia del reporte, no en el
  GPS de la persona.
- **El punto guarda su origen** (`origen_punto`: `gps` o `mapa`) para que HyS
  distinga en el panel lo tomado en el lugar de lo marcado a mano. El del mapa
  no tiene `error_metros`. Los dos valen igual, también para la paralización.
- **Una vez enviado, el pin del mapa solo lo mueve HyS (o Admin)**, desde la
  corrección; queda en la auditoría. El autor, al editar su reporte pendiente,
  puede retomar el GPS o quitar el punto, pero no moverlo en el mapa.
- **Sin puntos extra por tener ubicación.** El formulario invita a marcarla
  ("HyS llega más rápido a la obra y lo tiene en cuenta al calificar"); el
  puntaje lo sigue decidiendo HyS al aprobar.

Alternativa descartada: Google Maps (pide una clave con facturación).
