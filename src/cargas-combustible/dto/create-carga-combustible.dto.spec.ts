import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCargaCombustibleDto } from './create-carga-combustible.dto';

const bodyBase = {
  fechaCarga: '2026-07-30', movilId: '1', litros: '40.5', monto: '52000', km: '123456',
  medioPago: 'caja', nroComprobante: 'FC 0001-00001234',
  estacionId: '1', tipoCombustibleId: '2', provinciaId: '1',
};

describe('CreateCargaCombustibleDto', () => {
  it('acepta tareaIds como JSON string bien formado', async () => {
    const dto = plainToInstance(CreateCargaCombustibleDto, { ...bodyBase, tareaIds: '[10,20]' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.tareaIds).toEqual([10, 20]);
  });

  it('rechaza tareaIds con JSON malformado con error de validación (no excepción)', async () => {
    const dto = plainToInstance(CreateCargaCombustibleDto, { ...bodyBase, tareaIds: '[10,' });
    const errors = await validate(dto);
    const tareaIdsError = errors.find((e) => e.property === 'tareaIds');
    expect(tareaIdsError).toBeDefined();
    expect(tareaIdsError?.constraints).toHaveProperty('isArray');
  });
});
