import { Test } from '@nestjs/testing';
import { ExtraccionTicketService } from './extraccion-ticket.service';
import { PrismaService } from '../prisma/prisma.service';

const foto = { buffer: Buffer.from('img'), mimetype: 'image/jpeg' as const };

const jsonModelo = (extra: object) => JSON.stringify({
  legible: true, litros: 62.575, monto: 168013.88, fecha: '2026-07-15',
  nroComprobante: 'R 0021-00059874', tipoCombustible: 'gasoil', estacion: 'YPF Centenario',
  ...extra,
});

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
      tipoComprobante: null, medioPagoSugerido: null, confianzaNumero: null,
      lineaOrigenNumero: null, precioLitro: null, advertenciaCoherencia: null,
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
      tipoComprobante: null, medioPagoSugerido: null, confianzaNumero: null,
      lineaOrigenNumero: null, precioLitro: null, advertenciaCoherencia: null,
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
        tipoComprobante: null, medioPagoSugerido: null, confianzaNumero: null,
        lineaOrigenNumero: null, precioLitro: null, advertenciaCoherencia: null,
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

  it('deriva medioPagoSugerido cuenta_corriente para REMITO', async () => {
    const clienteMock = { messages: { create: jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: jsonModelo({ tipoComprobante: 'REMITO' }) }],
    }) } };
    const service = new ExtraccionTicketService(prismaMock as PrismaService, clienteMock as any);
    const r = await service.extraer(foto);
    expect(r.sugerencias?.tipoComprobante).toBe('REMITO');
    expect(r.sugerencias?.medioPagoSugerido).toBe('cuenta_corriente');
  });

  it('deriva medioPagoSugerido caja para FACTURA_B y TIQUE', async () => {
    for (const tipoComprobante of ['FACTURA_B', 'TIQUE']) {
      const clienteMock = { messages: { create: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: jsonModelo({ tipoComprobante }) }],
      }) } };
      const service = new ExtraccionTicketService(prismaMock as PrismaService, clienteMock as any);
      const r = await service.extraer(foto);
      expect(r.sugerencias?.tipoComprobante).toBe(tipoComprobante);
      expect(r.sugerencias?.medioPagoSugerido).toBe('caja');
    }
  });

  it('tipoComprobante inválido o ausente → null y medioPagoSugerido null', async () => {
    for (const extra of [{ tipoComprobante: 'CUALQUIERA' }, {}]) {
      const clienteMock = { messages: { create: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: jsonModelo(extra) }],
      }) } };
      const service = new ExtraccionTicketService(prismaMock as PrismaService, clienteMock as any);
      const r = await service.extraer(foto);
      expect(r.sugerencias?.tipoComprobante).toBeNull();
      expect(r.sugerencias?.medioPagoSugerido).toBeNull();
    }
  });

  it('confianzaNumero passthrough validado, inválido → null', async () => {
    const clienteAlta = { messages: { create: jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: jsonModelo({ confianzaNumero: 'alta' }) }],
    }) } };
    const serviceAlta = new ExtraccionTicketService(prismaMock as PrismaService, clienteAlta as any);
    const rAlta = await serviceAlta.extraer(foto);
    expect(rAlta.sugerencias?.confianzaNumero).toBe('alta');

    const clienteInvalido = { messages: { create: jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: jsonModelo({ confianzaNumero: 'altísima' }) }],
    }) } };
    const serviceInvalido = new ExtraccionTicketService(prismaMock as PrismaService, clienteInvalido as any);
    const rInvalido = await serviceInvalido.extraer(foto);
    expect(rInvalido.sugerencias?.confianzaNumero).toBeNull();
  });

  it('lineaOrigenNumero se trunca a 200 chars', async () => {
    const larga = 'x'.repeat(300);
    const clienteMock = { messages: { create: jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: jsonModelo({ lineaOrigenNumero: larga }) }],
    }) } };
    const service = new ExtraccionTicketService(prismaMock as PrismaService, clienteMock as any);
    const r = await service.extraer(foto);
    expect(r.sugerencias?.lineaOrigenNumero).toHaveLength(200);
  });

  it('advertenciaCoherencia cuando litros×precio difiere >5% del monto', async () => {
    const clienteCierra = { messages: { create: jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: jsonModelo({ precioLitro: 2685 }) }],
    }) } };
    const serviceCierra = new ExtraccionTicketService(prismaMock as PrismaService, clienteCierra as any);
    const rCierra = await serviceCierra.extraer(foto);
    expect(rCierra.sugerencias?.advertenciaCoherencia).toBeNull();

    const clienteNoCierra = { messages: { create: jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: jsonModelo({ precioLitro: 3000 }) }],
    }) } };
    const serviceNoCierra = new ExtraccionTicketService(prismaMock as PrismaService, clienteNoCierra as any);
    const rNoCierra = await serviceNoCierra.extraer(foto);
    expect(rNoCierra.sugerencias?.advertenciaCoherencia).not.toBeNull();
    expect(rNoCierra.sugerencias?.advertenciaCoherencia).toContain('187725.00');
    expect(rNoCierra.sugerencias?.advertenciaCoherencia).toContain('168013.88');

    const clienteSinPrecio = { messages: { create: jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: jsonModelo({}) }],
    }) } };
    const serviceSinPrecio = new ExtraccionTicketService(prismaMock as PrismaService, clienteSinPrecio as any);
    const rSinPrecio = await serviceSinPrecio.extraer(foto);
    expect(rSinPrecio.sugerencias?.advertenciaCoherencia).toBeNull();
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
