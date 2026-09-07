import { ResolucionService, MapaMaestro } from './resolucion.service';

const mapaDe = (entradas: Record<string, string[]>): MapaMaestro => {
  const contratosPorItem = new Map(Object.entries(entradas));
  return {
    contratosPorItem,
    existe: (codigo: string) => {
      const norm = codigo.replace(/\./g, ',');
      const ks = contratosPorItem.get(norm);
      return !!ks && ks.length > 0;
    },
  };
};

describe('ResolucionService.resolverContratoFinal', () => {
  const service = new ResolucionService({} as any);

  it('editado gana siempre, aunque el ítem esté en el maestro', () => {
    const mapa = mapaDe({ '123': ['K6', 'K9'] });
    const r = service.resolverContratoFinal(mapa, '123', 'K8', 'K12');
    expect(r).toEqual({ contrato: 'K12', fuente: 'editado' });
  });

  it('sin editado: maestro con archivo coincidente gana sobre el orden', () => {
    const mapa = mapaDe({ '123': ['K6', 'K9'] });
    const r = service.resolverContratoFinal(mapa, '123', 'K9', null);
    expect(r).toEqual({ contrato: 'K9', fuente: 'maestro' });
  });

  it('sin editado y archivo no coincide con ninguno del maestro: primero por orden id_item', () => {
    const mapa = mapaDe({ '123': ['K6', 'K9'] });
    const r = service.resolverContratoFinal(mapa, '123', 'K8', null);
    expect(r).toEqual({ contrato: 'K6', fuente: 'maestro' });
  });

  it('sin editado y sin contrato de archivo: primero por orden id_item', () => {
    const mapa = mapaDe({ '123': ['K6', 'K9'] });
    const r = service.resolverContratoFinal(mapa, '123', null, null);
    expect(r).toEqual({ contrato: 'K6', fuente: 'maestro' });
  });

  it('ítem no está en el maestro: usa el contrato del archivo', () => {
    const mapa = mapaDe({});
    const r = service.resolverContratoFinal(mapa, '999', 'K8', null);
    expect(r).toEqual({ contrato: 'K8', fuente: 'archivo' });
  });

  it('ítem no está en el maestro y no hay contrato de archivo: null', () => {
    const mapa = mapaDe({});
    const r = service.resolverContratoFinal(mapa, '999', null, null);
    expect(r).toEqual({ contrato: null, fuente: 'archivo' });
  });

  it('normaliza el código del ítem (punto≡coma) para buscar en el mapa', () => {
    const mapa = mapaDe({ '1,5': ['K6'] });
    const r = service.resolverContratoFinal(mapa, '1.5', null, null);
    expect(r).toEqual({ contrato: 'K6', fuente: 'maestro' });
  });

  it('contratoEditado vacío ("") no cuenta como editado', () => {
    const mapa = mapaDe({ '123': ['K6'] });
    const r = service.resolverContratoFinal(mapa, '123', 'K8', '');
    expect(r.fuente).toBe('maestro');
  });
});

describe('ResolucionService.cargarMaestro', () => {
  it('arma el mapa código-normalizado -> Ks en el orden que devuelve la query (por id_item)', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([
        { item_norm: '123', codigo_k: 'K6' },
        { item_norm: '123', codigo_k: 'K9' },
        { item_norm: '1,5', codigo_k: 'K8' },
      ]),
    } as any;
    const service = new ResolucionService(prisma);

    const mapa = await service.cargarMaestro(['123', '1.5', '999']);

    expect(mapa.contratosPorItem.get('123')).toEqual(['K6', 'K9']);
    expect(mapa.contratosPorItem.get('1,5')).toEqual(['K8']);
    expect(mapa.existe('123')).toBe(true);
    expect(mapa.existe('1.5')).toBe(true); // normaliza antes de consultar
    expect(mapa.existe('999')).toBe(false);
  });

  it('con lista vacía no consulta la BD', async () => {
    const prisma = { $queryRaw: jest.fn() } as any;
    const service = new ResolucionService(prisma);
    const mapa = await service.cargarMaestro([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(mapa.contratosPorItem.size).toBe(0);
  });
});

describe('ResolucionService.cargarItemsPorId', () => {
  const ROW = {
    id_item: 77n,
    item_codigo: '5',
    codigo_k: 'K8',
    id_contrato: 2n,
    tarea: 'Adicional servicios > 3 m',
    unidad_medida: 'un',
    ptos_gasnor: null as unknown,
    tipo: null,
    contratista: null,
  };

  it('consulta el maestro por id_item con un IN de los ids pedidos (items + contratos)', async () => {
    const queryRaw = jest.fn().mockResolvedValue([ROW]);
    const service = new ResolucionService({ $queryRaw: queryRaw } as any);

    await service.cargarItemsPorId([77, 78]);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const query = queryRaw.mock.calls[0][0];
    const sql = query.strings.join('?');
    expect(sql).toContain('sth_cert_items');
    expect(sql).toContain('dc.codigo_k');
    expect(sql).toContain('dc.id_contrato');
    expect(sql).toContain('di.id_item IN (');
    expect(query.values).toEqual([77, 78]);
  });

  it('normaliza los BigInt de id_item/id_contrato a number', async () => {
    const service = new ResolucionService({ $queryRaw: jest.fn().mockResolvedValue([ROW]) } as any);
    const mapa = await service.cargarItemsPorId([77]);
    const it = mapa.get(77)!;
    expect(it).toBeDefined();
    expect(typeof it.id_item).toBe('number');
    expect(it.id_item).toBe(77);
    expect(typeof it.id_contrato).toBe('number');
    expect(it.id_contrato).toBe(2);
  });

  it('ptos_gasnor Decimal/desconocido sale como string; null sigue null', async () => {
    const decimal = { toString: () => '12.3400' }; // como lo devuelve el driver para DECIMAL
    const service = new ResolucionService({
      $queryRaw: jest.fn().mockResolvedValue([
        { ...ROW, ptos_gasnor: decimal },
        { ...ROW, id_item: 78n, ptos_gasnor: null },
        { ...ROW, id_item: 79n, ptos_gasnor: undefined },
      ]),
    } as any);

    const mapa = await service.cargarItemsPorId([77, 78, 79]);
    expect(mapa.get(77)!.ptos_gasnor).toBe('12.3400');
    expect(typeof mapa.get(77)!.ptos_gasnor).toBe('string');
    expect(mapa.get(78)!.ptos_gasnor).toBeNull();
    expect(mapa.get(79)!.ptos_gasnor).toBeNull();
  });

  it('lista vacía no consulta la BD y devuelve un Map vacío', async () => {
    const queryRaw = jest.fn();
    const service = new ResolucionService({ $queryRaw: queryRaw } as any);
    const mapa = await service.cargarItemsPorId([]);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(mapa.size).toBe(0);
  });

  it('filtra ids no enteros (NaN, decimales) y deduplica antes de consultar', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const service = new ResolucionService({ $queryRaw: queryRaw } as any);
    await service.cargarItemsPorId([77, 77, 1.5, NaN, Infinity, 78]);
    expect(queryRaw.mock.calls[0][0].values).toEqual([77, 78]);
  });

  it('si TODOS los ids son no enteros no consulta la BD', async () => {
    const queryRaw = jest.fn();
    const service = new ResolucionService({ $queryRaw: queryRaw } as any);
    const mapa = await service.cargarItemsPorId([1.5, NaN]);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(mapa.size).toBe(0);
  });
});

describe('ResolucionService.contratosExistentes', () => {
  it('devuelve el Set de Ks que existen en el maestro (1 sola query batch)', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ codigo_k: 'K12' }, { codigo_k: 'K8' }]);
    const service = new ResolucionService({ $queryRaw: queryRaw } as any);

    const set = await service.contratosExistentes(['K12', 'K8', 'KZZ', 'K12']);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const query = queryRaw.mock.calls[0][0];
    expect(query.strings.join('?')).toContain('sth_cert_contratos');
    expect(query.values).toEqual(['K12', 'K8', 'KZZ']); // deduplicado
    expect(set.has('K12')).toBe(true);
    expect(set.has('K8')).toBe(true);
    expect(set.has('KZZ')).toBe(false);
  });

  it('lista vacía (o solo vacíos) → Set vacío sin consultar la BD', async () => {
    const queryRaw = jest.fn();
    const service = new ResolucionService({ $queryRaw: queryRaw } as any);
    expect((await service.contratosExistentes([])).size).toBe(0);
    expect((await service.contratosExistentes(['', '   '])).size).toBe(0);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

describe('ResolucionService.resolverIds', () => {
  it('resuelve id_item por código+K, id_contrato por K, id_provincia por UPPER y ptos_gasnor del archivo', async () => {
    const prisma = {
      $queryRaw: jest
        .fn()
        // items
        .mockResolvedValueOnce([
          { id_item: 10, item_norm: '123', codigo_k: 'K6', ptos_gasnor: '5.5' },
          { id_item: 11, item_norm: '123', codigo_k: 'K9', ptos_gasnor: '7' },
        ])
        // contratos
        .mockResolvedValueOnce([{ id_contrato: 1, codigo_k: 'K6' }])
        // provincias
        .mockResolvedValueOnce([{ id: 3, provincia: 'Salta' }]),
    } as any;
    const service = new ResolucionService(prisma);

    const resultado = await service.resolverIds([
      { item_codigo: '123', contrato: 'K6', provincia: 'salta', ptos_gasnor: '2' },
    ]);

    expect(resultado.get(0)).toEqual({ idItem: 10, idContrato: 1, idProvincia: 3, ptosGasnor: '2' });
  });

  it('fallback de id_item a cualquier K, por MENOR id_item (determinismo consciente vs el LIMIT 1 sin ORDER BY del portal)', async () => {
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          { id_item: 20, item_norm: '123', codigo_k: 'K9', ptos_gasnor: null },
          { id_item: 25, item_norm: '123', codigo_k: 'K12', ptos_gasnor: null },
        ])
        .mockResolvedValueOnce([{ id_contrato: 4, codigo_k: 'K6' }])
        .mockResolvedValueOnce([]),
    } as any;
    const service = new ResolucionService(prisma);

    // El contrato final resuelto es K6, pero el maestro no tiene el ítem en K6:
    // debe caer al de menor id_item entre los que sí tiene (K9, id 20).
    const resultado = await service.resolverIds([
      { item_codigo: '123', contrato: 'K6', provincia: 'Jujuy', ptos_gasnor: null },
    ]);

    expect(resultado.get(0)?.idItem).toBe(20);
  });

  it('ptos_gasnor cae al del maestro si el archivo no lo trae', async () => {
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id_item: 30, item_norm: '123', codigo_k: 'K6', ptos_gasnor: '9' }])
        .mockResolvedValueOnce([{ id_contrato: 1, codigo_k: 'K6' }])
        .mockResolvedValueOnce([]),
    } as any;
    const service = new ResolucionService(prisma);

    const resultado = await service.resolverIds([
      { item_codigo: '123', contrato: 'K6', provincia: '', ptos_gasnor: null },
    ]);

    expect(resultado.get(0)?.ptosGasnor).toBe('9');
  });

  it('ptos_gasnor null si ni el archivo ni el maestro lo tienen', async () => {
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id_item: 30, item_norm: '123', codigo_k: 'K6', ptos_gasnor: null }])
        .mockResolvedValueOnce([{ id_contrato: 1, codigo_k: 'K6' }])
        .mockResolvedValueOnce([]),
    } as any;
    const service = new ResolucionService(prisma);

    const resultado = await service.resolverIds([
      { item_codigo: '123', contrato: 'K6', provincia: '', ptos_gasnor: '' },
    ]);

    expect(resultado.get(0)?.ptosGasnor).toBeNull();
  });

  it('ítem/contrato/provincia sin match devuelven null en su id respectivo', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]),
    } as any;
    const service = new ResolucionService(prisma);

    const resultado = await service.resolverIds([
      { item_codigo: '999', contrato: 'K1', provincia: 'Marte', ptos_gasnor: null },
    ]);

    expect(resultado.get(0)).toEqual({ idItem: null, idContrato: null, idProvincia: null, ptosGasnor: null });
  });

  it('lista vacía no consulta la BD', async () => {
    const prisma = { $queryRaw: jest.fn() } as any;
    const service = new ResolucionService(prisma);
    const resultado = await service.resolverIds([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(resultado.size).toBe(0);
  });

  it('resuelve varias filas en batch (1 sola tanda de queries)', async () => {
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          { id_item: 10, item_norm: '123', codigo_k: 'K6', ptos_gasnor: null },
          { id_item: 40, item_norm: '456', codigo_k: 'K9', ptos_gasnor: null },
        ])
        .mockResolvedValueOnce([
          { id_contrato: 1, codigo_k: 'K6' },
          { id_contrato: 2, codigo_k: 'K9' },
        ])
        .mockResolvedValueOnce([
          { id: 3, provincia: 'Salta' },
          { id: 4, provincia: 'Jujuy' },
        ]),
    } as any;
    const service = new ResolucionService(prisma);

    const resultado = await service.resolverIds([
      { item_codigo: '123', contrato: 'K6', provincia: 'Salta', ptos_gasnor: null },
      { item_codigo: '456', contrato: 'K9', provincia: 'Jujuy', ptos_gasnor: null },
    ]);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
    expect(resultado.get(0)).toEqual({ idItem: 10, idContrato: 1, idProvincia: 3, ptosGasnor: null });
    expect(resultado.get(1)).toEqual({ idItem: 40, idContrato: 2, idProvincia: 4, ptosGasnor: null });
  });
});
