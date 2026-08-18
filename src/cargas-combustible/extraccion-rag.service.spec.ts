import { ExtraccionTicketService } from './extraccion-ticket.service';

const foto = { buffer: Buffer.from('img'), mimetype: 'image/jpeg' as const };

/** Capacidades nuevas del plan 2026-08-18: RAG (catálogo en el prompt), doble
 * lectura con consenso, verificaciones estructurales. */
describe('ExtraccionTicketService — RAG + doble lectura', () => {
  const prismaBase = () => ({
    estacionServicio: {
      findMany: jest.fn().mockResolvedValue([
        { id: 5, nombre: 'Estación Sur S.R.L.', cuit: '30712345678' },
        { id: 9, nombre: 'Puma Norte', cuit: null },
      ]),
    },
    tipoCombustible: { findMany: jest.fn().mockResolvedValue([{ id: 2, nombre: 'Gasoil', aliases: [] }]) },
    movil: { findMany: jest.fn().mockResolvedValue([{ id: 7, identificador: 'AB123CD' }]) },
    cargaCombustible: { findFirst: jest.fn().mockResolvedValue(null) },
  });
  const respuesta = (json: object) => ({ content: [{ type: 'text', text: JSON.stringify(json) }] });
  const base = { legible: true, litros: 40, precioLitro: 1000, monto: 40000, nroComprobante: 'R 0001-00000123' };

  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it('el prompt incluye el catálogo de la empresa (RAG) con ids, nombres y CUIT', async () => {
    const create = jest.fn().mockResolvedValue(respuesta(base));
    const service = new ExtraccionTicketService(prismaBase() as any, { messages: { create } } as any);
    await service.extraer(foto);
    const prompt = create.mock.calls[0][0].messages[0].content[1].text;
    expect(prompt).toContain('CATÁLOGO DE LA EMPRESA');
    expect(prompt).toContain('5 | Estación Sur S.R.L.');
    expect(prompt).toContain('30712345678');
    expect(prompt).toContain('7 | AB123CD');
  });

  it('lee la foto DOS veces', async () => {
    const create = jest.fn().mockResolvedValue(respuesta(base));
    const service = new ExtraccionTicketService(prismaBase() as any, { messages: { create } } as any);
    await service.extraer(foto);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('si las dos lecturas discrepan en el remito, el campo va null y queda marcado', async () => {
    const create = jest
      .fn()
      .mockResolvedValueOnce(respuesta({ ...base, nroComprobante: 'R 0001-00000123' }))
      .mockResolvedValueOnce(respuesta({ ...base, nroComprobante: 'R 0001-00000129' }));
    const service = new ExtraccionTicketService(prismaBase() as any, { messages: { create } } as any);
    const r = await service.extraer(foto);
    expect(r.sugerencias?.nroComprobante).toBeNull();
    expect(r.sugerencias?.camposInseguros).toContain('nroComprobante');
    expect(r.sugerencias?.litros).toBe(40); // lo que sí coincide sobrevive
  });

  it('acepta el estacionId que el modelo eligió del catálogo', async () => {
    const create = jest.fn().mockResolvedValue(respuesta({ ...base, estacionId: 9 }));
    const service = new ExtraccionTicketService(prismaBase() as any, { messages: { create } } as any);
    const r = await service.extraer(foto);
    expect(r.sugerencias?.estacionId).toBe(9);
  });

  it('ignora un id que el modelo haya inventado fuera del catálogo', async () => {
    const create = jest.fn().mockResolvedValue(respuesta({ ...base, estacionId: 999, movilId: 888 }));
    const service = new ExtraccionTicketService(prismaBase() as any, { messages: { create } } as any);
    const r = await service.extraer(foto);
    expect(r.sugerencias?.estacionId).toBeNull();
    expect(r.sugerencias?.movilId).toBeNull();
  });

  it('el CUIT exacto gana sobre la elección del modelo', async () => {
    const create = jest.fn().mockResolvedValue(respuesta({ ...base, estacionId: 9, cuitEstacion: '30-71234567-8' }));
    const service = new ExtraccionTicketService(prismaBase() as any, { messages: { create } } as any);
    const r = await service.extraer(foto);
    expect(r.sugerencias?.estacionId).toBe(5);
  });

  it('avisa si ya existe una carga con el mismo comprobante en esa estación', async () => {
    const prisma = prismaBase();
    prisma.cargaCombustible.findFirst = jest.fn().mockResolvedValue({ id: 42 });
    const create = jest.fn().mockResolvedValue(respuesta({ ...base, estacionId: 9 }));
    const service = new ExtraccionTicketService(prisma as any, { messages: { create } } as any);
    const r = await service.extraer(foto);
    expect(r.sugerencias?.alertaDuplicado).toEqual({ cargaId: 42 });
  });

  it('si la cuenta litros×precio no cierra, marca los tres importes como inseguros', async () => {
    const create = jest.fn().mockResolvedValue(respuesta({ ...base, monto: 99999 }));
    const service = new ExtraccionTicketService(prismaBase() as any, { messages: { create } } as any);
    const r = await service.extraer(foto);
    expect(r.sugerencias?.camposInseguros).toEqual(expect.arrayContaining(['litros', 'precioLitro', 'monto']));
    expect(r.sugerencias?.advertenciaCoherencia).toContain('no coincide');
  });

  it('si una de las dos lecturas falla, degrada marcando TODO como inseguro', async () => {
    const create = jest
      .fn()
      .mockResolvedValueOnce(respuesta(base))
      .mockRejectedValueOnce(new Error('timeout'));
    const service = new ExtraccionTicketService(prismaBase() as any, { messages: { create } } as any);
    const r = await service.extraer(foto);
    expect(r.legible).toBe(true);
    expect(r.sugerencias?.camposInseguros).toContain('nroComprobante');
    expect(r.sugerencias?.camposInseguros).toContain('monto');
  });
});
