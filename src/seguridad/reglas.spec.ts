import {
  armarRanking,
  erroresDeCampos,
  hoyAr,
  movimientosDe,
  puedeCalificar,
  puntoDelReporte,
  puedeInspeccionar,
  rangoConsulta,
} from './reglas';

describe('reglas de Autogestión de la Seguridad', () => {
  describe('erroresDeCampos', () => {
    it('un aviso de riesgo pide naturaleza y control', () => {
      expect(erroresDeCampos({ tipo: 'aviso_riesgo' })).toEqual([
        'Falta la naturaleza del riesgo',
        'Falta lo que hiciste para controlar el riesgo',
      ]);
      expect(erroresDeCampos({ tipo: 'aviso_riesgo', naturalezaId: 1, controlRiesgo: 'Vallé la zanja' })).toEqual([]);
    });

    it('el control en blanco cuenta como faltante', () => {
      expect(erroresDeCampos({ tipo: 'incidente', naturalezaId: 1, controlRiesgo: '   ' })).toContain(
        'Falta lo que hiciste para controlar el riesgo',
      );
    });

    it('la paralización pide motivo y no naturaleza', () => {
      expect(erroresDeCampos({ tipo: 'paralizacion', motivoParalizacionId: 2, controlRiesgo: 'Bajamos la cuadrilla', tienePunto: true })).toEqual([]);
      expect(erroresDeCampos({ tipo: 'paralizacion', naturalezaId: 1, motivoParalizacionId: 2, controlRiesgo: 'x', tienePunto: true })).toEqual([
        'Este tipo de reporte no lleva naturaleza',
      ]);
    });

    it('la paralización exige el punto GPS: hay que saber de qué obra se trata', () => {
      expect(erroresDeCampos({ tipo: 'paralizacion', motivoParalizacionId: 2, controlRiesgo: 'x' })).toEqual([
        'Falta tomar la ubicación: hay que saber de qué obra se trata',
      ]);
      expect(erroresDeCampos({ tipo: 'aviso_riesgo', naturalezaId: 1, controlRiesgo: 'x' })).toEqual([]);
    });

    it('la propuesta de mejora no lleva control, naturaleza ni involucrados', () => {
      expect(erroresDeCampos({ tipo: 'propuesta_mejora' })).toEqual([]);
      expect(
        erroresDeCampos({ tipo: 'propuesta_mejora', controlRiesgo: 'algo', involucrados: ['20111111111'] }),
      ).toEqual(['Una propuesta de mejora no lleva control del riesgo', 'Este tipo de reporte no lleva personas involucradas']);
    });

    it('la inspección exige al menos una persona observada', () => {
      expect(erroresDeCampos({ tipo: 'inspeccion', naturalezaId: 5, controlRiesgo: 'Se frenó la tarea' })).toEqual([
        'Una inspección necesita al menos una persona observada',
      ]);
      expect(
        erroresDeCampos({ tipo: 'inspeccion', naturalezaId: 5, controlRiesgo: 'Se frenó la tarea', involucrados: ['20111111111'] }),
      ).toEqual([]);
    });
  });

  describe('movimientosDe', () => {
    const base = { autorCuil: 'AUTOR', involucrados: ['A', 'B'] };

    it('un reporte aprobado suma su puntaje al autor, no a los involucrados', () => {
      expect(movimientosDe({ ...base, tipo: 'aviso_riesgo', estado: 'aprobado', puntaje: 8 })).toEqual([
        { cuil: 'AUTOR', puntos: 8 },
      ]);
    });

    it('aprobado con 0 genera movimiento (HyS lo validó): aparece en el ranking', () => {
      expect(movimientosDe({ ...base, tipo: 'incidente', estado: 'aprobado', puntaje: 0 })).toEqual([
        { cuil: 'AUTOR', puntos: 0 },
      ]);
    });

    it('la inspección resta a cada involucrado y no suma nada a HyS', () => {
      expect(movimientosDe({ ...base, tipo: 'inspeccion', estado: 'aprobado', puntaje: 6 })).toEqual([
        { cuil: 'A', puntos: -6 },
        { cuil: 'B', puntos: -6 },
      ]);
    });

    it('un involucrado repetido no resta dos veces', () => {
      expect(
        movimientosDe({ autorCuil: 'HYS', involucrados: ['A', 'A'], tipo: 'inspeccion', estado: 'aprobado', puntaje: 3 }),
      ).toEqual([{ cuil: 'A', puntos: -3 }]);
    });

    it.each(['pendiente', 'desaprobado', 'anulado'])('un reporte %s no genera movimientos', (estado) => {
      expect(movimientosDe({ ...base, tipo: 'aviso_riesgo', estado, puntaje: null })).toEqual([]);
    });
  });

  describe('puedeCalificar', () => {
    it('nadie califica su propio reporte', () => {
      expect(puedeCalificar({ tipo: 'aviso_riesgo', autorCuil: 'HYS1' }, 'HYS1')).toBe(false);
      expect(puedeCalificar({ tipo: 'aviso_riesgo', autorCuil: 'HYS1' }, 'HYS2')).toBe(true);
    });

    it('la autora de una inspección sí la aprueba: no suma nada', () => {
      expect(puedeCalificar({ tipo: 'inspeccion', autorCuil: 'HYS1' }, 'HYS1')).toBe(true);
    });
  });

  describe('puedeInspeccionar', () => {
    it('HyS siempre; el resto, solo si está habilitado como inspector', () => {
      expect(puedeInspeccionar('HyS', false)).toBe(true);
      expect(puedeInspeccionar('Supervisor', false)).toBe(false);
      expect(puedeInspeccionar('Supervisor', true)).toBe(true);
    });
  });

  describe('armarRanking', () => {
    it('suma positivos y negativos por persona y ordena por total', () => {
      const r = armarRanking([
        { cuil: 'A', puntos: 8 },
        { cuil: 'B', puntos: 10 },
        { cuil: 'A', puntos: 6 },
        { cuil: 'A', puntos: -6 },
      ]);
      expect(r).toEqual([
        { cuil: 'B', mas: 10, menos: 0, total: 10, puesto: 1 },
        { cuil: 'A', mas: 14, menos: 6, total: 8, puesto: 2 },
      ]);
    });

    it('quien queda en 0 por +10 y −10 aparece; quien no tiene movimientos, no', () => {
      const r = armarRanking([
        { cuil: 'A', puntos: 10 },
        { cuil: 'A', puntos: -10 },
      ]);
      expect(r).toEqual([{ cuil: 'A', mas: 10, menos: 10, total: 0, puesto: 1 }]);
    });

    it('alguien que nunca reportó puede quedar negativo por inspecciones', () => {
      const r = armarRanking([
        { cuil: 'A', puntos: 5 },
        { cuil: 'G', puntos: -6 },
      ]);
      expect(r.map((f) => [f.cuil, f.total, f.puesto])).toEqual([
        ['A', 5, 1],
        ['G', -6, 2],
      ]);
    });

    it('los empates comparten puesto y el siguiente salta', () => {
      const r = armarRanking([
        { cuil: 'A', puntos: 9 },
        { cuil: 'B', puntos: 7 },
        { cuil: 'C', puntos: 7 },
        { cuil: 'D', puntos: 2 },
      ]);
      expect(r.map((f) => f.puesto)).toEqual([1, 2, 2, 4]);
    });

    it('deja afuera a quienes no compiten', () => {
      const r = armarRanking(
        [
          { cuil: 'A', puntos: 9 },
          { cuil: 'HYS', puntos: 10 },
        ],
        new Set(['HYS']),
      );
      expect(r.map((f) => f.cuil)).toEqual(['A']);
    });
  });

  describe('puntoDelReporte', () => {
    const camara = (lat: number, err: number | null) => ({ origen: 'camara' as const, latitud: lat, longitud: -65, errorMetros: err });

    it('elige la foto de cámara con menor error', () => {
      expect(puntoDelReporte([camara(-26.1, 30), camara(-26.2, 8), camara(-26.3, 15)])).toEqual({
        latitud: -26.2,
        longitud: -65,
        errorMetros: 8,
        origen: 'foto',
      });
    });

    it('el GPS tomado con el botón manda sobre las fotos', () => {
      expect(puntoDelReporte([camara(-26.2, 3)], { latitud: -24.7, longitud: -65.4, errorMetros: 12 })).toEqual({
        latitud: -24.7,
        longitud: -65.4,
        errorMetros: 12,
        origen: 'gps',
      });
      expect(puntoDelReporte([camara(-26.2, 3)], { latitud: null, longitud: null, errorMetros: null })?.origen).toBe('foto');
    });

    it('ignora las de galería aunque traigan coordenadas', () => {
      expect(
        puntoDelReporte([{ origen: 'galeria', latitud: -24, longitud: -65, errorMetros: 1 }, camara(-26.8, 40)]),
      ).toEqual({ latitud: -26.8, longitud: -65, errorMetros: 40, origen: 'foto' });
    });

    it('sin fotos de cámara con ubicación no hay punto', () => {
      expect(puntoDelReporte([])).toBeNull();
      expect(puntoDelReporte([{ origen: 'camara', latitud: null, longitud: null, errorMetros: null }])).toBeNull();
    });

    it('una foto sin error informado pierde contra una que lo informa', () => {
      expect(puntoDelReporte([camara(-26.1, null), camara(-26.2, 500)])?.latitud).toBe(-26.2);
    });
  });

  describe('rangoConsulta', () => {
    it('por defecto, el año en curso hasta hoy', () => {
      expect(rangoConsulta(undefined, undefined, '2026-10-08')).toEqual({ desde: '2026-01-01', hasta: '2026-10-08' });
    });
    it('respeta el rango pedido', () => {
      expect(rangoConsulta('2026-07-01', '2026-09-30T00:00:00Z', '2026-10-08')).toEqual({ desde: '2026-07-01', hasta: '2026-09-30' });
    });
  });

  describe('hoyAr', () => {
    it('usa el día de Argentina aunque en UTC ya sea mañana', () => {
      // 02:00 UTC del 8/10 = 23:00 del 7/10 en Argentina (UTC-3)
      expect(hoyAr(new Date('2026-10-08T02:00:00Z'))).toBe('2026-10-07');
    });
  });
});
