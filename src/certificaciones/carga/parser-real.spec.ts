/**
 * Corre contra los PDFs REALES de Naturgy (no se commitean). Se saltea si
 * CERT_PDF_DIR no está definido. Uso local:
 *   $env:CERT_PDF_DIR = 'C:\Users\Administrador\Downloads'; npm run test:cert-real
 *
 * No se afirma nada sobre `tarea`: un problema preexistente de límites de
 * columna puede truncar ese campo (fuera de alcance de esta etapa).
 */
import * as fs from 'fs';
import * as path from 'path';
import { parsearPdf } from './parser-pdf';
import { esFilaPlantilla, cuadraturaFila } from './validacion';

const dir = process.env.CERT_PDF_DIR;
const d = dir && fs.existsSync(dir) ? describe : describe.skip;

async function leer(nombre: string) {
  const buf = fs.readFileSync(path.join(dir!, nombre));
  return parsearPdf(buf, nombre, 2026, 8);
}
const suma = (filas: { total_mes: string | null }[]) =>
  filas.reduce((a, f) => a + Number(f.total_mes ?? 0), 0);

d('PDFs reales agosto 2026', () => {
  it('K8 Capex: 8 filas, todas cuadran, suma = total declarado ± 1', async () => {
    const r = await leer('CERTIFICADOS SERTEC (K8) -agosto 26 -Capex.pdf');
    const vis = r.filas.filter((f) => !esFilaPlantilla(f));
    expect(vis).toHaveLength(8);
    expect(vis.map((f) => f.item_codigo)).toContain('5');
    for (const f of vis) expect(cuadraturaFila(f).cuadra).toBe(true);
    expect(r.total_declarado).toBeCloseTo(22535209.93, 2);
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
