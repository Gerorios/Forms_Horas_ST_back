import { esFilaPlantilla, revalidarFila, filtrarVisiblesPreview } from './validacion';
import { FilaParseada } from './parser-tipos';

const filaBase = (over: Partial<FilaParseada> = {}): FilaParseada => ({
  hoja_origen: 'CERTIF K6',
  archivo_origen: 'archivo.xlsx',
  item_codigo: '123',
  nombre_contrato: null,
  tarea: 'Tarea X',
  contrato: 'K6',
  unidad_medida: null,
  ptos_gasnor: null,
  tipo: null,
  contratista: null,
  provincia: 'Salta',
  region: '',
  cantidades: '3',
  precio_unitario: null,
  total_mes: '100',
  observaciones: null,
  fecha: '2026-08-01',
  nro_np: null,
  tiene_error: false,
  fila_excel: 5,
  ...over,
});

describe('esFilaPlantilla', () => {
  it('cantidad 0 y total null -> plantilla', () => {
    expect(esFilaPlantilla({ cantidades: '0', total_mes: null })).toBe(true);
  });

  it('cantidad null y total 0 -> plantilla', () => {
    expect(esFilaPlantilla({ cantidades: null, total_mes: '0' })).toBe(true);
  });

  it('cantidad null y total null -> plantilla', () => {
    expect(esFilaPlantilla({ cantidades: null, total_mes: null })).toBe(true);
  });

  it('cantidad "3" -> no es plantilla aunque el total sea null', () => {
    expect(esFilaPlantilla({ cantidades: '3', total_mes: null })).toBe(false);
  });

  it('total con plata -> no es plantilla aunque la cantidad sea 0', () => {
    expect(esFilaPlantilla({ cantidades: '0', total_mes: '50' })).toBe(false);
  });

  it('el unitario solo NO cuenta como contenido (no forma parte del cálculo)', () => {
    // Archivos de Naturgy: catálogo completo con unitario y cantidad 0.
    expect(esFilaPlantilla({ cantidades: '0', total_mes: null })).toBe(true);
  });

  it('cantidades no numérica se trata como null (parseo fallido)', () => {
    expect(esFilaPlantilla({ cantidades: 'abc', total_mes: null })).toBe(true);
  });
});

describe('revalidarFila', () => {
  const opts = { itemExiste: true, provinciasValidas: ['Salta', 'Jujuy'] };

  it('fila completa y válida -> sin error', () => {
    const r = revalidarFila(filaBase(), opts);
    expect(r).toEqual({ tieneError: false, detalle: null });
  });

  it('ítem no encontrado en el maestro -> texto exacto', () => {
    const r = revalidarFila(filaBase({ item_codigo: '999' }), { ...opts, itemExiste: false });
    expect(r.tieneError).toBe(true);
    expect(r.detalle).toBe('Ítem 999 no encontrado en el maestro');
  });

  it('falta contrato K -> texto exacto', () => {
    const r = revalidarFila(filaBase({ contrato: '' }), opts);
    expect(r.detalle).toBe('Falta contrato K');
  });

  it('falta provincia -> texto exacto', () => {
    const r = revalidarFila(filaBase({ provincia: '' }), opts);
    expect(r.detalle).toBe('Falta provincia');
  });

  it('provincia inválida (no está en las activas) -> texto exacto con el valor', () => {
    const r = revalidarFila(filaBase({ provincia: 'Marte' }), opts);
    expect(r.detalle).toBe("Provincia 'Marte' inválida");
  });

  it('provincia válida se matchea case-insensitive (UPPER=UPPER)', () => {
    const r = revalidarFila(filaBase({ provincia: 'salta' }), opts);
    expect(r.tieneError).toBe(false);
  });

  it('falta cantidad (null) -> texto exacto', () => {
    const r = revalidarFila(filaBase({ cantidades: null }), opts);
    expect(r.detalle).toBe('Falta cantidad');
  });

  it('cantidad 0 también cuenta como "falta cantidad"', () => {
    const r = revalidarFila(filaBase({ cantidades: '0' }), opts);
    expect(r.detalle).toBe('Falta cantidad');
  });

  it('falta total mes -> texto exacto', () => {
    const r = revalidarFila(filaBase({ total_mes: null }), opts);
    expect(r.detalle).toBe('Falta total mes');
  });

  it('total mes 0 es válido (no cuenta como falta)', () => {
    const r = revalidarFila(filaBase({ total_mes: '0' }), opts);
    expect(r.tieneError).toBe(false);
  });

  it('falta unitario NO cuenta como falta (puede faltar si hay total)', () => {
    const r = revalidarFila(filaBase({ precio_unitario: null }), opts);
    expect(r.tieneError).toBe(false);
  });

  it('varias faltas se unen con "; " en el orden: item, contrato, provincia, cantidad, total', () => {
    const r = revalidarFila(filaBase({ contrato: '', provincia: '', cantidades: null, total_mes: null }), {
      ...opts,
      itemExiste: false,
    });
    expect(r.detalle).toBe(
      'Ítem 123 no encontrado en el maestro; Falta contrato K; Falta provincia; Falta cantidad; Falta total mes',
    );
  });
});

describe('filtrarVisiblesPreview', () => {
  it('oculta las filas de plantilla y deja el resto', () => {
    const filas = [
      filaBase({ item_codigo: 'A', cantidades: '0', total_mes: null }), // plantilla
      filaBase({ item_codigo: 'B', cantidades: '5', total_mes: '10' }),
      filaBase({ item_codigo: 'C', cantidades: null, total_mes: '0' }), // plantilla
    ];
    const visibles = filtrarVisiblesPreview(filas);
    expect(visibles.map((f) => f.item_codigo)).toEqual(['B']);
  });
});
