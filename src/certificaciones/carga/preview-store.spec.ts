import { PreviewStore, PreviewSession, FilaPreview } from './preview-store';

function filaPreview(overrides: Partial<FilaPreview> = {}): FilaPreview {
  return {
    hoja_origen: 'CERTIF K12',
    archivo_origen: 'archivo.xlsx',
    item_codigo: '431',
    nombre_contrato: null,
    tarea: 'Tarea',
    contrato: 'K12',
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
    rowId: 'row-1',
    item_en_maestro: true,
    error_detalle: null,
    contrato_archivo: 'K12',
    contrato_fuente: 'archivo',
    contrato_del_maestro: null,
    excluida: false,
    ...overrides,
  };
}

function sesion(overrides: Partial<PreviewSession> = {}): PreviewSession {
  const fila = filaPreview();
  return {
    id: 'preview-1',
    ownerCuil: '20111111112',
    archivo: 'archivo.xlsx',
    anio: 2026,
    mes: 8,
    filas: new Map([[fila.rowId, fila]]),
    creadaEn: Date.now(),
    ...overrides,
  };
}

describe('PreviewStore', () => {
  it('guarda y recupera una sesión por el mismo owner', () => {
    const store = new PreviewStore();
    const s = sesion();
    const id = store.guardar(s);
    expect(id).toBe('preview-1');
    expect(store.recuperar('preview-1', '20111111112')).toBe(s);
  });

  it('recuperar devuelve null si el id no existe', () => {
    const store = new PreviewStore();
    expect(store.recuperar('no-existe', '20111111112')).toBeNull();
  });

  it('recuperar devuelve null si la sesión expiró (> 30 minutos)', () => {
    const store = new PreviewStore();
    const s = sesion({ creadaEn: Date.now() - 31 * 60 * 1000 });
    store.guardar(s);
    expect(store.recuperar(s.id, s.ownerCuil)).toBeNull();
  });

  it('recuperar acepta justo antes del límite de 30 minutos', () => {
    const store = new PreviewStore();
    const s = sesion({ creadaEn: Date.now() - 29 * 60 * 1000 });
    store.guardar(s);
    expect(store.recuperar(s.id, s.ownerCuil)).toBe(s);
  });

  it('recuperar devuelve null si el owner (cuil) es distinto (fix B1)', () => {
    const store = new PreviewStore();
    const s = sesion({ ownerCuil: '20111111112' });
    store.guardar(s);
    expect(store.recuperar(s.id, '20999999999')).toBeNull();
  });

  it('limpiar elimina la sesión (ya no se puede recuperar)', () => {
    const store = new PreviewStore();
    const s = sesion();
    store.guardar(s);
    store.limpiar(s.id);
    expect(store.recuperar(s.id, s.ownerCuil)).toBeNull();
  });

  it('una sesión expirada se borra del mapa al intentar leerla (no crece indefinidamente)', () => {
    const store = new PreviewStore();
    const s = sesion({ creadaEn: Date.now() - 31 * 60 * 1000 });
    store.guardar(s);
    store.recuperar(s.id, s.ownerCuil);
    // segunda lectura: sigue null (ya no está, no explota)
    expect(store.recuperar(s.id, s.ownerCuil)).toBeNull();
  });
});
