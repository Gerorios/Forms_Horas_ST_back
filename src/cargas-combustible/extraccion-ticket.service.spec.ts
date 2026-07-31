import { ExtraccionTicketService } from './extraccion-ticket.service';
import { PrismaService } from '../prisma/prisma.service';

const foto = { buffer: Buffer.from('img'), mimetype: 'image/jpeg' as const };

describe('ExtraccionTicketService', () => {
  const prismaMock: any = {
    estacionServicio: { findMany: jest.fn().mockResolvedValue([{ id: 1, nombre: 'YPF Centenario' }]) },
    tipoCombustible: { findMany: jest.fn().mockResolvedValue([{ id: 2, nombre: 'Gasoil' }]) },
  };

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
});
