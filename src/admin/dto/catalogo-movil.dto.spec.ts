import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateMovilDto, UpdateMovilDto } from './catalogo.dto';

/** El identificador es la patente del móvil, y sin él la fila no sirve para
 * nada: no se puede elegir en una carga de horas ni matchear contra un ticket.
 * La UI ya lo exige, pero el DTO es el que tiene que frenar un POST directo. */
describe('CreateMovilDto — identificador obligatorio', () => {
  it('acepta un identificador con contenido', async () => {
    const dto = plainToInstance(CreateMovilDto, { identificador: 'AA615NF' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rechaza el identificador vacío', async () => {
    const dto = plainToInstance(CreateMovilDto, { identificador: '' });
    const error = (await validate(dto)).find((e) => e.property === 'identificador');
    expect(error?.constraints).toHaveProperty('isNotEmpty');
  });

  it('rechaza el identificador de puros espacios', async () => {
    const dto = plainToInstance(CreateMovilDto, { identificador: '   ' });
    const error = (await validate(dto)).find((e) => e.property === 'identificador');
    expect(error?.constraints).toHaveProperty('isNotEmpty');
  });

  it('rechaza el alta sin identificador', async () => {
    const dto = plainToInstance(CreateMovilDto, { descripcion: 'Camioneta' });
    const error = (await validate(dto)).find((e) => e.property === 'identificador');
    expect(error).toBeDefined();
  });

  it('sigue aceptando los identificadores que no son patentes', async () => {
    // En la flota hay "TACHO PAÑOL", "S/N" y "HQJ 539": la regla es que haya
    // algo, no que tenga forma de patente.
    for (const identificador of ['TACHO PAÑOL', 'S/N', 'HQJ 539']) {
      const dto = plainToInstance(CreateMovilDto, { identificador });
      expect(await validate(dto)).toHaveLength(0);
    }
  });
});

describe('UpdateMovilDto — no se puede vaciar el identificador', () => {
  it('acepta que no venga (se edita solo la descripción)', async () => {
    const dto = plainToInstance(UpdateMovilDto, { descripcion: 'Camioneta blanca' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rechaza vaciarlo si viene', async () => {
    const dto = plainToInstance(UpdateMovilDto, { identificador: '  ' });
    const error = (await validate(dto)).find((e) => e.property === 'identificador');
    expect(error?.constraints).toHaveProperty('isNotEmpty');
  });
});
