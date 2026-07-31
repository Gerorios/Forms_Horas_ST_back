import { Test } from '@nestjs/testing';
import { ExtraccionTicketService } from './extraccion-ticket.service';
import { PrismaService } from '../prisma/prisma.service';

const foto = { buffer: Buffer.from('img'), mimetype: 'image/jpeg' as const };

describe('ExtraccionTicketService', () => {
  const prismaMock: any = {
    estacionServicio: { findMany: jest.fn().mockResolvedValue([{ id: 1, nombre: 'YPF Centenario' }]) },
    tipoCombustible: { findMany: jest.fn().mockResolvedValue([{ id: 2, nombre: 'Gasoil' }]) },
  };

  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it('sin API key devuelve ilegible sin llamar a la API', async () => {
    const service = new ExtraccionTicketService(prismaMock as PrismaService, undefined);
    expect(await service.extraer(foto)).toEqual({ legible: false, sugerencias: null });
  });

  it('parsea la respuesta del modelo y matchea catálogos', async () => {
    const clienteMock = { messages: { create: jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: '{"legible":true,"litros":40.5,"monto":52000,"fecha":"2026-07-30","nroComprobante":"0001-00001234","tipoCombustible":"gasoil","estacion":"YPF Centenario"}' }],
    }) } };
    const service = new ExtraccionTicketService(prismaMock as PrismaService, clienteMock as any);
    const r = await service.extraer(foto);
    expect(r.legible).toBe(true);
    expect(r.sugerencias).toEqual({
      litros: 40.5, monto: 52000, fechaCarga: '2026-07-30',
      nroComprobante: '0001-00001234', tipoCombustibleId: 2, estacionId: 1,
    });
  });

  it('si la API tira error devuelve ilegible (degradación)', async () => {
    const clienteMock = { messages: { create: jest.fn().mockRejectedValue(new Error('overloaded')) } };
    const service = new ExtraccionTicketService(prismaMock as PrismaService, clienteMock as any);
    expect(await service.extraer(foto)).toEqual({ legible: false, sugerencias: null });
  });

  it('parsea la respuesta aunque venga envuelta en fences con newline final', async () => {
    const clienteMock = { messages: { create: jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: '```json\n{"legible":true,"litros":40.5,"monto":52000,"fecha":"2026-07-30","nroComprobante":"0001-00001234","tipoCombustible":"gasoil","estacion":"YPF Centenario"}\n```\n' }],
    }) } };
    const service = new ExtraccionTicketService(prismaMock as PrismaService, clienteMock as any);
    const r = await service.extraer(foto);
    expect(r.legible).toBe(true);
    expect(r.sugerencias).toEqual({
      litros: 40.5, monto: 52000, fechaCarga: '2026-07-30',
      nroComprobante: '0001-00001234', tipoCombustibleId: 2, estacionId: 1,
    });
  });
  it('usa OpenAI como proveedor alternativo cuando solo hay OPENAI_API_KEY', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"legible":true,"litros":40.5,"monto":52000,"fecha":"2026-07-30","nroComprobante":"0001-00001234","tipoCombustible":"gasoil","estacion":"YPF Centenario"}' } }] }),
    });
    const fetchOriginal = global.fetch;
    global.fetch = fetchMock as any;
    try {
      const service = new ExtraccionTicketService(prismaMock as PrismaService, undefined);
      const r = await service.extraer(foto);
      expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/chat/completions', expect.objectContaining({ method: 'POST' }));
      expect(r.legible).toBe(true);
      expect(r.sugerencias).toEqual({
        litros: 40.5, monto: 52000, fechaCarga: '2026-07-30',
        nroComprobante: '0001-00001234', tipoCombustibleId: 2, estacionId: 1,
      });
    } finally {
      global.fetch = fetchOriginal;
      delete process.env.OPENAI_API_KEY;
    }
  });

  it('si OpenAI responde error HTTP degrada a ilegible', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const fetchOriginal = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' }) as any;
    try {
      const service = new ExtraccionTicketService(prismaMock as PrismaService, undefined);
      expect(await service.extraer(foto)).toEqual({ legible: false, sugerencias: null });
    } finally {
      global.fetch = fetchOriginal;
      delete process.env.OPENAI_API_KEY;
    }
  });
});

describe('ExtraccionTicketService — resolución de dependencias vía Nest DI', () => {
  it('resuelve sin ANTHROPIC_CLIENT registrado (no debe tirar UnknownDependenciesException)', async () => {
    const prismaMock: any = {
      estacionServicio: { findMany: jest.fn().mockResolvedValue([]) },
      tipoCombustible: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [ExtraccionTicketService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    const service = moduleRef.get(ExtraccionTicketService);
    expect(service).toBeInstanceOf(ExtraccionTicketService);
    expect(await service.extraer(foto)).toEqual({ legible: false, sugerencias: null });
  });
});
