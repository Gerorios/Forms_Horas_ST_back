import { duplicadosExactos, RegistroComparable } from './duplicados';

const base = (over: Partial<RegistroComparable> = {}): RegistroComparable => ({
  id: 1,
  operarioCuil: '20-11111111-1',
  fecha: new Date('2026-08-05T00:00:00Z'),
  horas: 8,
  contratoId: 1,
  tareas: [{ tareaId: 10 }],
  moviles: [{ movilId: 5 }],
  ...over,
});

describe('duplicadosExactos', () => {
  it('marca dos registros idénticos en todo (aunque sean de lotes distintos)', () => {
    const r = duplicadosExactos([base({ id: 1 }), base({ id: 2 })]);
    expect(r.idsDuplicados).toEqual(new Set([1, 2]));
    expect(r.cuilesConDuplicado).toEqual(new Set(['20-11111111-1']));
  });

  it('NO marca si difieren las horas', () => {
    const r = duplicadosExactos([base({ id: 1 }), base({ id: 2, horas: 4 })]);
    expect(r.idsDuplicados.size).toBe(0);
  });

  it('NO marca si difiere el contrato', () => {
    const r = duplicadosExactos([base({ id: 1 }), base({ id: 2, contratoId: 2 })]);
    expect(r.idsDuplicados.size).toBe(0);
  });

  it('NO marca si difieren las tareas', () => {
    const r = duplicadosExactos([base({ id: 1 }), base({ id: 2, tareas: [{ tareaId: 11 }] })]);
    expect(r.idsDuplicados.size).toBe(0);
  });

  it('NO marca si difieren los móviles', () => {
    const r = duplicadosExactos([base({ id: 1 }), base({ id: 2, moviles: [] })]);
    expect(r.idsDuplicados.size).toBe(0);
  });

  it('el orden de tareas/móviles no importa', () => {
    const r = duplicadosExactos([
      base({ id: 1, tareas: [{ tareaId: 10 }, { tareaId: 11 }], moviles: [{ movilId: 5 }, { movilId: 6 }] }),
      base({ id: 2, tareas: [{ tareaId: 11 }, { tareaId: 10 }], moviles: [{ movilId: 6 }, { movilId: 5 }] }),
    ]);
    expect(r.idsDuplicados).toEqual(new Set([1, 2]));
  });

  it('horas Decimal (string/objeto) se compara por valor numérico', () => {
    const r = duplicadosExactos([base({ id: 1, horas: '8.00' }), base({ id: 2, horas: 8 })]);
    expect(r.idsDuplicados).toEqual(new Set([1, 2]));
  });

  it('tres clones marcan los tres ids', () => {
    const r = duplicadosExactos([base({ id: 1 }), base({ id: 2 }), base({ id: 3 })]);
    expect(r.idsDuplicados).toEqual(new Set([1, 2, 3]));
  });
});
