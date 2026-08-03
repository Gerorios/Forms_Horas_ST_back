# ADR-013: Módulo de Carga de combustible

## Contexto

Las cargas de combustible de los vehículos de la empresa se registran hoy en un
Google Forms externo: patente tipeada a mano, estación y tipo de combustible en
texto libre, número de remito/factura, km del vehículo, actividad, y la foto del
ticket como respaldo. El Forms es limitado en parametrización, genera datos
sucios (errores de tipeo en patentes, estaciones escritas de mil maneras) y es
un sistema separado más que usa el personal. El objetivo es unificarlo dentro de
esta app.

El glosario ya lo anticipaba: "tickets de combustible quedan explícitamente
diferidos" (nota en `Línea de carga`). Este ADR los destraba.

## Decisión

1. **Entidad nueva: `CargaCombustible`** (`sth_cargas_combustible`). Nunca se le
   dice "carga" a secas — ese término ya significa envío de horas (`loteId`).
   Campos: móvil, fecha de carga declarada, litros, monto, km del vehículo,
   medio de pago, número de comprobante, estación, tipo de combustible,
   provincia, observaciones opcionales, foto del ticket, tareas (M:N).
2. **Registra solo el Jefe de Cuadrilla** (y Admin). El Jefe de Contrato no
   registra: solo consulta, en modo lectura, las cargas asociadas a sus
   contratos. Quien cargó el combustible es el usuario logueado (su CUIL);
   no hay campo de conductor aparte.
3. **Sin flujo de aprobación.** Registro directo. El control posterior es
   administrativo (tablero de Power BI contra la BD; no hay export propio).
4. **Se reusa el catálogo `Movil` existente** — su `identificador` ya es la
   patente. El móvil se elige de la lista, nunca se tipea la patente.
5. **Tareas M:N contra `TareaCatalogo`**, elegibles según los contratos
   habilitados del usuario (`ContratoHabilitado`). Una misma carga puede
   mezclar tareas de contratos distintos (un solo tanque, varias tareas del
   día); el gasto no se prorratea entre contratos.
6. **Dos medios de pago fijos** (no catálogo): `cuenta_corriente` (comprobante:
   remito) y `caja` (comprobante: factura). El número de comprobante es
   **obligatorio siempre**, además de la foto.
7. **Catálogos administrables nuevos**: Estación de servicio (sin marca de
   "tiene cuenta corriente") y Tipo de combustible (seed: gasoil, gasoil
   premium, súper, premium, GNC).
8. **Validación blanda de km**: si el km ingresado es menor al último
   registrado para ese móvil, se advierte pero no se bloquea (tableros
   arreglados y errores previos rompen la monotonía; un bloqueo duro genera
   datos inventados). Subproducto: consumo por vehículo (km recorridos /
   litros).
9. **Ciclo de vida sin borrado físico**: el JdC edita su propia carga sin
   límite de tiempo, con auditoría (tabla `Auditoria` existente). Para
   deshacer, estado `anulada` con motivo — sale de reportes, queda el rastro
   y la foto. Admin edita/anula cualquiera.
10. **Foto del ticket: una por carga, obligatoria**, en el **filesystem del
    VPS**: comprimida en el cliente, guardada como archivo en disco, la BD
    almacena solo la ruta, servida únicamente por endpoint autenticado. El
    acceso al disco queda detrás de un servicio de storage propio para poder
    migrar a storage en la nube (S3/R2) cambiando la implementación, no el
    módulo.
11. **Asistente de IA en v1** (se construye al final, el módulo debe funcionar
    completo sin él): flujo foto-primero — se sube la foto, el backend la envía
    a un modelo con visión vía la API de Anthropic (modelo económico, p. ej.
    Haiku) y pre-rellena litros, monto, fecha, número de comprobante, tipo de
    combustible y estación (matcheada contra el catálogo). **La IA solo
    sugiere**: todos los valores quedan editables y el JdC confirma. Si la
    lectura falla, la app sugiere retomar la foto (reemplazando la anterior) y
    el formulario manual sigue funcionando igual. Requiere API key de
    Anthropic en el VPS.

## Consecuencias

- Datos limpios para el tablero de PBI: patentes, estaciones y combustibles
  normalizados por catálogo, imposibles de tipear mal.
- El disco del VPS pasa a contener datos de negocio (las fotos): la carpeta de
  tickets debe entrar en el backup, y hay que vigilar espacio libre
  (~300 KB/foto comprimida; pendiente verificar el disco cuando se autorice la
  clave SSH).
- El gasto de una carga multi-contrato no se puede atribuir limpio a un único
  contrato — si administración necesitara prorratear por contrato, habrá que
  repensar el punto 5.
- Nueva dependencia operativa opcional: API de Anthropic (si no responde, el
  módulo sigue funcionando a mano).

## Alternativas consideradas

- **Circuito de aprobación (como horas)** — descartado por el dueño del
  producto: el Forms actual no lo tiene y nadie lo pide; agregar estados
  obliga a diseñar desaprobación/corrección sin necesidad real. Fácil de
  agregar después.
- **Entidad `Vehiculo` separada de `Movil`** — descartada: son los mismos
  vehículos y el identificador ya es la patente; dos catálogos duplicarían
  administración.
- **Storage en la nube desde el día uno** — descartado: suma dependencia
  externa y credenciales para un volumen chico (~GB/año); la abstracción de
  storage deja la puerta abierta.
- **BLOB en la BD** — descartado: infla MySQL y complica backups.
- **Varias fotos por carga** — descartado por el dueño del producto: una foto
  alcanza; si salió mal, se reemplaza por una mejor antes de enviar.
- **Marca "tiene cuenta corriente" por estación** — descartada explícitamente:
  estación y medio de pago se eligen de forma independiente.
