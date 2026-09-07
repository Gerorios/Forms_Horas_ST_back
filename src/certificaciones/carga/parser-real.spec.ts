/**
 * Corre contra los archivos REALES de Naturgy (no se commitean). Hay DOS
 * bloques, cada uno con su propia variable de entorno, y cada bloque se
 * saltea si la suya no está definida (o el directorio no existe):
 *   - `CERT_PDF_DIR` → certificaciones en PDF (`parsearPdf`).
 *   - `CERT_XLS_DIR` → certificaciones en Excel/xlsm (`parsearExcel`).
 *
 * Uso local (los dos apuntan a la misma carpeta de descargas):
 *   $env:CERT_PDF_DIR = 'C:\Users\Administrador\Downloads'
 *   $env:CERT_XLS_DIR = 'C:\Users\Administrador\Downloads'
 *   npm run test:cert-real
 *
 * Los conteos afirmados acá son la LÍNEA BASE que el parser ya producía antes
 * de esta rama (medida con la corrida diagnóstica del controller): son
 * regresión pura, no hay que aflojarlos si fallan.
 *
 * No se afirma nada sobre `tarea`: un problema preexistente de límites de
 * columna puede truncar ese campo (fuera de alcance de esta etapa).
 */
import * as fs from 'fs';
import * as path from 'path';
import { parsearPdf } from './parser-pdf';
import { parsearExcel } from './parser-excel';
import { esFilaPlantilla, cuadraturaFila } from './validacion';

const dir = process.env.CERT_PDF_DIR;
const d = dir && fs.existsSync(dir) ? describe : describe.skip;

const dirXls = process.env.CERT_XLS_DIR;
const dx = dirXls && fs.existsSync(dirXls) ? describe : describe.skip;

async function leer(nombre: string) {
  const buf = fs.readFileSync(path.join(dir!, nombre));
  return parsearPdf(buf, nombre, 2026, 8);
}

async function leerXls(nombre: string, anio = 2026, mes = 7) {
  const buf = fs.readFileSync(path.join(dirXls!, nombre));
  return parsearExcel(buf, nombre, anio, mes);
}

/** Filas que el preview muestra al usuario (las de plantilla no se cuentan). */
const visibles = <T extends { cantidades: string | null; total_mes: string | null }>(
  filas: T[],
): T[] => filas.filter((f) => !esFilaPlantilla(f));
const suma = (filas: { total_mes: string | null }[]) =>
  filas.reduce((a, f) => a + Number(f.total_mes ?? 0), 0);

d('PDFs reales agosto 2026', () => {
  it('K8 Capex: 8 filas, todas cuadran, suma = total declarado ± 1', async () => {
    const r = await leer('CERTIFICADOS SERTEC (K8) -agosto 26 -Capex.pdf');
    const vis = r.filas.filter((f) => !esFilaPlantilla(f));
    expect(vis).toHaveLength(8);
    expect(vis.map((f) => f.item_codigo)).toContain('5');
    for (const f of vis) expect(cuadraturaFila(f).cuadra).toBe(true);
    // Naturgy imprime "TOTAL MES" redondeado sin centavos (22.535.210); el
    // total neto con centavos (22.535.209,93) es OTRO campo del header ("TOTAL
    // A CERTIFICAR NETO") — la brecha de 7 centavos la absorbe la tolerancia
    // de $1 de la cuadratura a nivel carga (ver ruling del controller, T8 fix
    // round 2).
    expect(r.total_declarado).toBe(22535210);
    expect(Math.abs(suma(vis) - r.total_declarado!)).toBeLessThanOrEqual(1);
    expect(r.k_nombre_archivo).toBe('K8');
    expect(r.periodo_archivo).toEqual({ desde: '2026-08-01', hasta: '2026-08-30' });
  });

  it('K8 Opex: total 677.910 y NP 362000594', async () => {
    const r = await leer('CERTIFICADOS SERTEC (K8) -agosto 26 -Opex.pdf');
    expect(r.filas[0].total_mes).toBe('677910');
    expect(r.filas[0].nro_np).toBe('362000594');
    expect(r.total_declarado).toBe(677910);
  });

  it('K11 Capex: columna CUENTA ignorada, cantidad 221, cuadra', async () => {
    const r = await leer(
      'CERTIFICADO AGOSTO 2026 SERTEC - K11 - Capex (Inspecciones rehabiltiación de servicio).pdf',
    );
    expect(r.columnas_ignoradas).toEqual(['CUENTA']);
    expect(r.filas[0].cantidades).toBe('221');
    expect(cuadraturaFila(r.filas[0]).cuadra).toBe(true);
    expect(r.filas[0].contrato).toBe('K2');
    expect(r.k_nombre_archivo).toBe('K11');
    expect(r.filas[0].nro_np).toBe('362000594'); // etiqueta "NRO. WK"
  });

  it('K11 Opex (contrato K2): cantidad 109 y cuadra', async () => {
    const r = await leer(
      'CERTIFICADO AGOSTO 2026 SERTEC - K11 - Opex (Inspecciones rehabiltiación de servicio).pdf',
    );
    expect(r.filas[0].cantidades).toBe('109');
    expect(cuadraturaFila(r.filas[0]).cuadra).toBe(true);
  });
});

dx('Excel/xlsm reales (junio y julio 2026)', () => {
  it('Agrupado ADECUACION CAPEX (.xlsm): 7 hojas, 25 filas visibles, contratos K9/K10', async () => {
    const r = await leerXls('CERTIFICADO AGRUPADO SERTEC ADECUACION CAPEX-1JUL31JUL ..xlsm', 2026, 7);
    expect(r.hojas).toHaveLength(7);
    expect(r.errores.filter((e) => e.campo === 'header')).toEqual([]);
    const vis = visibles(r.filas);
    expect(vis).toHaveLength(25);
    for (const f of vis) expect(f.precio_unitario).not.toBeNull();
    for (const c of new Set(vis.map((f) => f.contrato))) {
      expect(['K9', 'K10']).toContain(c);
    }
    // el nombre del archivo no trae ningún "K<n>" propio
    expect(r.k_nombre_archivo).toBeNull();
  }, 120000);

  it('K2 ODORIZACION junio: 2 filas visibles, total declarado 8.200.613,88, K del nombre = K2', async () => {
    const r = await leerXls('CERTIFICADO JUNIO 2026 SERTEC - K2- ODORIZACION.xlsx', 2026, 6);
    expect(r.errores.filter((e) => e.campo === 'header')).toEqual([]);
    const vis = visibles(r.filas);
    expect(vis).toHaveLength(2);
    expect(r.total_declarado).toBeCloseTo(8200613.88, 2);
    // el K del NOMBRE (K2) no coincide con el de las filas (hoja "Certificado
    // K9"): justamente el caso que el control de K del nombre tiene que ver.
    expect(r.k_nombre_archivo).toBe('K2');
    expect([...new Set(vis.map((f) => f.contrato))]).toEqual(['K9']);
    for (const f of vis) {
      expect(f.precio_unitario).not.toBeNull();
      expect(cuadraturaFila(f).cuadra).toBe(true);
    }
  }, 120000);

  it('K8 Julio Capex: 8 hojas, 57 filas visibles, contratos K8/K5/K6, todas cuadran', async () => {
    const r = await leerXls('CERTIFICADOS SERTEC (K8) -Julio 26-Capex.xlsx', 2026, 7);
    expect(r.hojas).toHaveLength(8);
    expect(r.errores.filter((e) => e.campo === 'header')).toEqual([]);
    const vis = visibles(r.filas);
    expect(vis).toHaveLength(57);
    for (const f of vis) {
      expect(f.precio_unitario).not.toBeNull();
      expect(cuadraturaFila(f).cuadra).toBe(true);
    }
    for (const c of new Set(vis.map((f) => f.contrato))) {
      expect(['K8', 'K5', 'K6']).toContain(c);
    }
  }, 120000);
});
