import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { EdicionFilaDto, FilaManualDto } from './carga.dto';

/**
 * Validación a nivel DTO de los tres campos de cifra (`cantidades`,
 * `precio_unitario`, `total_mes`) en las DOS clases que los tienen. Lo que
 * se prueba es la barrera de entrada: el service confía en que si una
 * cifra llegó, tiene forma de número tipeado a mano (entero con hasta 4
 * decimales, coma o punto), no algo que `Number()` acepte de casualidad.
 */

const errores = async (dto: object) => {
  const res = await validate(dto, { whitelist: true });
  return res.flatMap((e) => Object.keys(e.constraints ?? {}));
};

const ROW_ID = '3f1b4c9e-8a7d-4b2c-9e1f-5a6d7c8b9a01';

describe('EdicionFilaDto — cifras', () => {
  const edicion = (campos: Record<string, unknown>) =>
    plainToInstance(EdicionFilaDto, { rowId: ROW_ID, ...campos });

  const CAMPOS = ['cantidades', 'precio_unitario', 'total_mes'] as const;

  describe.each(CAMPOS)('%s', (campo) => {
    it.each(['1e3', 'Infinity', ' 7 ', 'NaN', '-5', '1.2.3', '3,14159', 'abc', ''])(
      'rechaza %p',
      async (valor) => {
        const res = await validate(edicion({ [campo]: valor }));
        expect(res).toHaveLength(1);
        expect(res[0].property).toBe(campo);
      },
    );

    it.each(['400012', '133337,26', '60607.84', '0', '4', '1,5', '12.0001'])(
      'acepta %p',
      async (valor) => {
        expect(await errores(edicion({ [campo]: valor }))).toEqual([]);
      },
    );

    it('el mensaje nombra el campo y los 4 decimales', async () => {
      const res = await validate(edicion({ [campo]: '1e3' }));
      expect(Object.values(res[0].constraints ?? {})).toContain(
        `${campo} debe ser un número (hasta 4 decimales)`,
      );
    });
  });

  it('los campos de cifra son opcionales (omitidos no fallan)', async () => {
    expect(await errores(edicion({}))).toEqual([]);
  });

  it('rechaza contrato/item_codigo de más de 30 caracteres y provincia de más de 50', async () => {
    expect(await errores(edicion({ contrato: 'K'.repeat(31) }))).toContain('maxLength');
    expect(await errores(edicion({ item_codigo: '1'.repeat(31) }))).toContain('maxLength');
    expect(await errores(edicion({ provincia: 'S'.repeat(51) }))).toContain('maxLength');
    expect(await errores(edicion({ contrato: 'K'.repeat(30), provincia: 'S'.repeat(50) }))).toEqual([]);
  });

  it('una cifra de más de 30 caracteres se rechaza aunque tenga forma de número', async () => {
    const res = await validate(edicion({ total_mes: `${'9'.repeat(31)}` }));
    expect(res).toHaveLength(1);
    expect(Object.keys(res[0].constraints ?? {})).toContain('maxLength');
  });
});

describe('FilaManualDto — cifras', () => {
  const manual = (campos: Record<string, unknown> = {}) =>
    plainToInstance(FilaManualDto, {
      id_item: 77,
      provincia: 'Salta',
      cantidades: '4',
      precio_unitario: '15151.96',
      total_mes: '60607.84',
      ...campos,
    });

  it('la fila manual base es válida', async () => {
    expect(await errores(manual())).toEqual([]);
  });

  it.each(['cantidades', 'precio_unitario', 'total_mes'] as const)(
    'rechaza %s con notación científica, Infinity o espacios',
    async (campo) => {
      for (const valor of ['1e3', 'Infinity', ' 7 ']) {
        const res = await validate(manual({ [campo]: valor }));
        expect(res.map((e) => e.property)).toEqual([campo]);
        expect(Object.keys(res[0].constraints ?? {})).toContain('matches');
      }
    },
  );

  it.each(['400012', '133337,26', '60607.84'] as const)('acepta %p en las tres cifras', async (valor) => {
    expect(
      await errores(manual({ cantidades: valor, precio_unitario: valor, total_mes: valor })),
    ).toEqual([]);
  });
});
