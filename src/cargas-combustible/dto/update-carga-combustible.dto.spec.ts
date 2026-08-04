import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateCargaCombustibleDto } from './update-carga-combustible.dto';

describe('UpdateCargaCombustibleDto', () => {
  it('acepta tareaIds como JSON string bien formado', async () => {
    const dto = plainToInstance(UpdateCargaCombustibleDto, { tareaIds: '[10,20]' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.tareaIds).toEqual([10, 20]);
  });

  it('rechaza tareaIds con JSON malformado con error de validación (no excepción)', async () => {
    const dto = plainToInstance(UpdateCargaCombustibleDto, { tareaIds: '[10,' });
    const errors = await validate(dto);
    const tareaIdsError = errors.find((e) => e.property === 'tareaIds');
    expect(tareaIdsError).toBeDefined();
    expect(tareaIdsError?.constraints).toHaveProperty('isArray');
  });
});
