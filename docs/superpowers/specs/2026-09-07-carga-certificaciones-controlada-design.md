# Carga de certificaciones controlada — diseño (2026-09-07)

Decisiones tomadas con el usuario en sesión de grilling (2026-09-07). Glosario
de los términos en `CONTEXT.md` → "Carga de certificaciones (Naturgy)".
Mockup aprobado: https://claude.ai/code/artifact/c68c6773-c612-47fa-a8ec-8978015804ab

## 1. Problema

Los 4 PDFs reales de agosto 2026 (`C:\Users\Administrador\Downloads\CERTIFICADO*agosto*.pdf`,
`CERTIFICADOS SERTEC (K8) -agosto 26 -*.pdf`) se leen MAL sin avisar:

| Falla | Ejemplo real | Efecto hoy |
|---|---|---|
| Montos sin centavos con punto de miles | "3.840.113", "400.012", "60.608" | `limpiarNum` los descarta (dos puntos) o los lee como 400,012 |
| Columna nueva CUENTA entre PROVINCIA y Cantidades | K11/K2 Opex+Capex | el nº de cuenta (922) entra como cantidad; la real es 221 |
| Ítem de 1 dígito | "5" Adicional servicios > 3 m, $ 60.608 | `esItemValido` exige 3 dígitos → fila perdida |
| Etiqueta del NP distinta | "NRO. WK" vs "NRO. DE NP" | NP null |
| Nombre del archivo ≠ contenido | archivo "K11", contenido K2 | sin aviso |
| Total declarado con miles | "22.535.210" | null → sin control |

Los 5 Excel reales (julio/junio) leen bien; comparten las debilidades de control.

## 2. Reglas de negocio (decisiones)

1. **Fila que cuadra.** `|cantidad × unitario − total| ≤ 1,00`. Si no cuadra, o falta
   unitario para poder cuadrar, la fila queda **bloqueada** hasta que la persona
   corrija alguna cifra o la marque **"Confirmar así"** (override explícito, por fila).
   Sugerencia automática: si `total / unitario` da un entero (±0,01), se ofrece
   "Usar cantidad N".
2. **Total declarado vs suma.** Cartel FUERTE (rojo) con la diferencia en pesos
   cuando `|Σ filas a cargar + Σ manuales − total_declarado| > 1`. **Se puede
   confirmar igual.** Si no hay total declarado (null o 0): aviso "no se pudo
   controlar contra el total declarado".
3. **Montos en texto.** Punto = miles, coma = decimal, SIEMPRE (PDF y celdas de
   texto de Excel). Celdas numéricas de Excel: valor real, sin tocar.
4. **Cabecera completa obligatoria.** Columnas requeridas: ítem, K, provincia,
   cantidad, unitario, total. Si falta alguna → error de hoja/página (no se
   procesan filas). Toda columna de la cabecera no reconocida se lista como
   **columna ignorada** y ocupa su propio rango: sus valores NO se asignan a la
   vecina.
5. **Fila de ítem (PDF).** Código = `^[A-Za-z]?\d+([-.,/][A-Za-z0-9]+)?$` (1+
   dígitos; "116-a" vale) Y la línea trae cantidad o total con plata. Las líneas
   que empiezan con algo que parece código pero no traen plata se reportan como
   aviso "línea no leída como fila" (no fallan).
6. **Contrato K.** Sin cambios en la resolución (editado > maestro > archivo).
   NUEVO aviso suave: si el nombre del archivo trae `K\d+` distinto de todos los
   K resueltos → "El nombre del archivo dice K11; se resolvió K2. Si la plata va
   a K11, cambiá el contrato." Nunca bloquea.
7. **Metadatos.** NP: etiquetas "NRO. DE NP" y "NRO. WK". Período del archivo:
   "PERIODO A CERTIFICAR d/m/yyyy d/m/yyyy" → si el mes/año del `hasta` (o del
   `desde`) no coincide con el período elegido → aviso FUERTE sin bloquear.
8. **Edición en el preview.** Editables: contrato, provincia, cantidad, unitario
   (nuevo), total, código de ítem (nuevo), excluida, confirmada (nuevo). NUEVO:
   **filas manuales**: ítem elegido del maestro (filtrado por los K del claim
   para nivel carga; todos para admin), provincia de la lista, cantidad, unitario,
   total (propuesto = cantidad × unitario), observaciones. Regla 1 aplica.
   Se guardan con `origen = 'manual'`, `hoja_origen = 'manual'`,
   `archivo_origen = archivo de la sesión`. El log de carga cuenta `filas_manuales`.
   Solo se aceptan si la sesión de preview existe (documento leído).
9. **Confirmación.** Se rechaza (422) si queda alguna fila no excluida con
   `tiene_error` y sin `confirmada` válida. `confirmada` SOLO levanta el bloqueo
   por cuadratura; ítem inexistente, contrato vacío, provincia inválida, cantidad
   0 o total ausente siguen bloqueando.
10. **Alcance.** PDF y Excel por igual: las reglas 1, 2, 4, 6, 7 viven en
    validación/servicio/preview, comunes a ambos parsers.

## 3. Contrato de datos (backend → frontend)

`ResultadoParseo` (parser-tipos.ts) suma:
```ts
avisos: AvisoParseo[];            // ver abajo
columnas_ignoradas: string[];     // títulos crudos, únicos, por archivo
periodo_archivo: { desde: string; hasta: string } | null;  // 'YYYY-MM-DD'
k_nombre_archivo: string | null;  // 'K11' extraído del nombre del archivo
```
```ts
interface AvisoParseo {
  tipo: 'columna_ignorada' | 'linea_no_leida' | 'sin_total_declarado'
      | 'periodo_archivo' | 'k_nombre_archivo' | 'np_no_detectado';
  hoja: string;
  fila: number;        // 0 si no aplica
  mensaje: string;
  fuerte: boolean;     // true → cartel rojo; false → panel de avisos ámbar
}
```
`FilaPreview` suma:
```ts
cuadratura: { calculado: number | null; impreso: number | null; diferencia: number | null; cuadra: boolean; sugerencia_cantidad: string | null };
confirmada: boolean;   // "Confirmar así"
origen: 'archivo' | 'manual';
```
`RespuestaPreview` suma `avisos`, `columnas_ignoradas`, `periodo_archivo`,
`k_nombre_archivo`; `resumen` suma `bloqueadas: number`.

`EdicionFilaDto` suma `precio_unitario?`, `item_codigo?`, `confirmada?`.
`ConfirmarCargaDto` suma `manuales: FilaManualDto[]` (máx. 200):
```ts
{ id_item: number; provincia: string; cantidades: string; precio_unitario: string;
  total_mes: string; observaciones?: string; confirmada?: boolean }
```
Nuevo `GET /certificaciones/carga/items-maestro` → `{ id_item, item_codigo,
codigo_k, tarea, unidad_medida }[]` filtrado por los K del claim (admin: todos).

`RespuestaConfirmar` suma `manuales: number`. Error 422 de bloqueadas:
`{ message: 'Hay N filas bloqueadas...', bloqueadas: [{ rowId, item_codigo, detalle }] }`.

## 4. Datos (DDL, ambas bases: `testing` y `Horas_Sertec`)

```sql
ALTER TABLE sth_cert_certificaciones ADD COLUMN origen ENUM('archivo','manual') NOT NULL DEFAULT 'archivo';
ALTER TABLE sth_cert_cargas_log ADD COLUMN filas_manuales INT NOT NULL DEFAULT 0;
```
La fact no es modelo Prisma (INSERT raw); el log sí (`CertCargaLog.filasManuales`).
El deshacer no cambia: borra por `archivo_origen`, que las manuales también llevan.

## 5. Fuera de alcance

Carga manual completa sin documento. Mapeo manual de columnas en UI. Bloquear
por total declarado. OneDrive. Apagado del portal viejo (sigue en pausa).

## 6. Verificación

- Tests unitarios (Jest) con palabras sintéticas para cada regla del parser.
- `parser-real.spec.ts`: corre contra los PDFs reales si `CERT_PDF_DIR` está
  definido (se saltea si no); asserts exactos de la tabla §1 corregida:
  K8 Capex → 8 filas, Σ = 22.535.209,93 ± 1 vs declarado; K11 → cantidad 221,
  columna ignorada CUENTA; K8 Opex → total 677.910.
- Frontend (Vitest): revalidar espejo + página (bloqueada deshabilita Confirmar,
  fila manual suma en cuadratura, cartel rojo).
- Manual en producción con los 4 PDFs de agosto (usuario), antes del cierre.
