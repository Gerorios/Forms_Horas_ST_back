import { Test } from '@nestjs/testing';
import { CalculoService } from './calculo.service';
import { PrismaService } from '../prisma/prisma.service';

describe('CalculoService — fórmula de "por tantos" (ADR-015)', () => {
  const prismaMock: any = {
    perfilLiquidacion: { findMany: jest.fn() },
    tipoNovedad: { findMany: jest.fn() },
    sueldoMensualizado: { findMany: jest.fn() },
    kmPorTantos: { findMany: jest.fn() },
    tarifaCategoriaUocra: { findMany: jest.fn() },
    montoNovedadPlus: { findMany: jest.fn() },
    bonoNoRemunerativo: { findMany: jest.fn() },
    rangoKmPorTantos: { findMany: jest.fn() },
    plusIndividual: { findMany: jest.fn() },
    registroHoras: { groupBy: jest.fn() },
    novedad: { findMany: jest.fn() },
  };
  let service: CalculoService;

  const PERFIL_POR_TANTOS = {
    cuil: '20999999999',
    regimen: 'por_tantos',
    categoriaUocraId: 1,
    modalidadPago: null,
    empleado: { apellido_nombre: 'RELEVADOR TEST', legajo: 1, cargo: 'Relevador', provincia: 'Córdoba' },
    categoria: { id: 1, nombre: 'Oficial' },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.tipoNovedad.findMany.mockResolvedValue([]);
    prismaMock.sueldoMensualizado.findMany.mockResolvedValue([]);
    prismaMock.montoNovedadPlus.findMany.mockResolvedValue([]);
    prismaMock.bonoNoRemunerativo.findMany.mockResolvedValue([]);
    prismaMock.plusIndividual.findMany.mockResolvedValue([]);
    prismaMock.registroHoras.groupBy.mockResolvedValue([]);
    prismaMock.novedad.findMany.mockResolvedValue([]);

    const mod = await Test.createTestingModule({
      providers: [CalculoService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = mod.get(CalculoService);
  });

  function setupKmYTarifa({ kmTotal, tarifaHora }: { kmTotal: number; tarifaHora: number }) {
    prismaMock.perfilLiquidacion.findMany.mockResolvedValue([PERFIL_POR_TANTOS]);
    prismaMock.kmPorTantos.findMany.mockResolvedValue([{ cuil: PERFIL_POR_TANTOS.cuil, kmTotal }]);
    prismaMock.tarifaCategoriaUocra.findMany.mockResolvedValue([
      { categoriaUocraId: 1, vigenteDesde: new Date(2026, 7, 1), importeHora: tarifaHora },
    ]);
    prismaMock.rangoKmPorTantos.findMany.mockResolvedValue([
      { vigenteDesde: new Date(2026, 7, 1), kmDesde: 0, kmHasta: null, precioPorKm: 100 },
    ]);
  }

  it('km × precio del rango ÷ (tarifa × 0.978, presentismo y cargas sociales) = horas totales, y separa CCT/extra con tope 88', async () => {
    setupKmYTarifa({ kmTotal: 1000, tarifaHora: 1000 }); // monto = 100.000; divisor = 1000 × 0,978 = 978
    const [fila] = await service.calcularQuincena(2026, 8, 1);

    expect(fila.montoKmBruto).toBe(100_000); // km × precio del rango, sin el ajuste (es previo a convertir a horas)
    expect(fila.horasTotal).toBeCloseTo(102.2495, 4); // 100.000 / 978
    expect(fila.horasCct).toBe(88); // tope
    expect(fila.horasExtra).toBeCloseTo(14.2495, 4);
    expect(fila.totalBruto).toBe(88_000); // básico = tarifa COMPLETA (sin ajuste) × horasCct
  });

  it('el monto en B NO es horasExtra × tarifa — es el residual del monto de km sobre el básico "grossed up"', async () => {
    setupKmYTarifa({ kmTotal: 1000, tarifaHora: 1000 }); // ver test anterior: montoKm=100.000, básico=88.000
    const [fila] = await service.calcularQuincena(2026, 8, 1);

    // montoExtra = montoKm − básico × 0,978 = 100.000 − 88.000 × 0,978 = 13.936
    expect(fila.montoHorasExtra).toBeCloseTo(13_936, 2);
    // Ni horasExtra × tarifa (14.249,5) ni con el ×1,5 de jornalizado (21.374,25) — confirma que no es un simple horas×precio.
    expect(fila.montoHorasExtra).not.toBeCloseTo(14_249.5, 0);
    expect(fila.montoHorasExtra).not.toBeCloseTo(21_374.25, 0);
  });

  it('sin horas extra (total ≤ 88), el extra da 0 — cálculo común de horas × tarifa para el básico', async () => {
    setupKmYTarifa({ kmTotal: 500, tarifaHora: 1000 }); // monto=50.000; horas = 50.000/978 ≈ 51.13 (< 88)
    const [fila] = await service.calcularQuincena(2026, 8, 1);

    expect(fila.horasTotal).toBeCloseTo(51.1247, 4);
    expect(fila.horasExtra).toBe(0);
    expect(fila.montoHorasExtra).toBe(0);
    expect(fila.totalBruto).toBeCloseTo(51_124.74, 2); // básico = horasTotal × tarifa completa
  });

  it('el bono no remunerativo NO entra en el residual del monto en B — es una línea totalmente separada', async () => {
    setupKmYTarifa({ kmTotal: 1000, tarifaHora: 1000 }); // montoExtra = 13.936 (ver test de arriba), con o sin bono
    prismaMock.bonoNoRemunerativo.findMany.mockResolvedValue([
      { categoriaUocraId: 1, vigenteDesde: new Date(2026, 7, 1), tipo: 'monto_fijo', valor: 33550 },
    ]);
    const [fila] = await service.calcularQuincena(2026, 8, 1);

    expect(fila.noRemunerativo).toBe(33550);
    expect(fila.montoHorasExtra).toBeCloseTo(13_936, 2); // sin cambios respecto al caso sin bono
  });

  it('falta km cargado: datoFaltante, sin calcular nada', async () => {
    prismaMock.perfilLiquidacion.findMany.mockResolvedValue([PERFIL_POR_TANTOS]);
    prismaMock.kmPorTantos.findMany.mockResolvedValue([]);
    prismaMock.tarifaCategoriaUocra.findMany.mockResolvedValue([
      { categoriaUocraId: 1, vigenteDesde: new Date(2026, 7, 1), importeHora: 1000 },
    ]);
    prismaMock.rangoKmPorTantos.findMany.mockResolvedValue([]);

    const [fila] = await service.calcularQuincena(2026, 8, 1);
    expect(fila.datoFaltante).toBe('Falta cargar los km de esta quincena');
    expect(fila.horasTotal).toBe(0);
  });

  it('falta categoría/tarifa asignada: datoFaltante distinto', async () => {
    prismaMock.perfilLiquidacion.findMany.mockResolvedValue([{ ...PERFIL_POR_TANTOS, categoriaUocraId: null, categoria: null }]);
    prismaMock.kmPorTantos.findMany.mockResolvedValue([{ cuil: PERFIL_POR_TANTOS.cuil, kmTotal: 500 }]);
    prismaMock.tarifaCategoriaUocra.findMany.mockResolvedValue([]);
    prismaMock.rangoKmPorTantos.findMany.mockResolvedValue([
      { vigenteDesde: new Date(2026, 7, 1), kmDesde: 0, kmHasta: null, precioPorKm: 100 },
    ]);

    const [fila] = await service.calcularQuincena(2026, 8, 1);
    expect(fila.datoFaltante).toBe('Sin categoría UOCRA / tarifa asignada (necesaria para convertir km a horas)');
  });

  it('jornalizado sigue con el multiplicador ×1.5 en el extra (sin cambios)', async () => {
    prismaMock.perfilLiquidacion.findMany.mockResolvedValue([
      {
        cuil: '20111111111',
        regimen: 'jornalizado',
        categoriaUocraId: 1,
        modalidadPago: 'en_b',
        empleado: { apellido_nombre: 'JORNALIZADO TEST', legajo: 2, cargo: 'Oficial', provincia: 'Córdoba' },
        categoria: { id: 1, nombre: 'Oficial' },
      },
    ]);
    prismaMock.kmPorTantos.findMany.mockResolvedValue([]);
    prismaMock.tarifaCategoriaUocra.findMany.mockResolvedValue([
      { categoriaUocraId: 1, vigenteDesde: new Date(2026, 7, 1), importeHora: 1000 },
    ]);
    prismaMock.rangoKmPorTantos.findMany.mockResolvedValue([]);
    prismaMock.registroHoras.groupBy.mockResolvedValue([{ operarioCuil: '20111111111', _sum: { horas: 100 } }]);

    const [fila] = await service.calcularQuincena(2026, 8, 1);
    expect(fila.horasExtra).toBe(12);
    expect(fila.montoHorasExtra).toBe(18_000); // 12 × 1000 × 1.5, sin cambios
    expect(fila.montoKmBruto).toBeNull();
  });

  describe('límites de los rangos de km (0–60 / 60–75 / 75–null)', () => {
    // Rango 1 excluye su propio tope (60), rango 2 incluye ambos extremos
    // (60 y 75), rango 3 (sin techo) excluye su propio piso (75) — ningún
    // km puede caer en dos rangos ni en ninguno.
    const TRES_RANGOS = [
      { vigenteDesde: new Date(2026, 7, 1), kmDesde: 0, kmHasta: 60, precioPorKm: 100 },
      { vigenteDesde: new Date(2026, 7, 1), kmDesde: 60, kmHasta: 75, precioPorKm: 200 },
      { vigenteDesde: new Date(2026, 7, 1), kmDesde: 75, kmHasta: null, precioPorKm: 300 },
    ];

    function setupConKm(kmTotal: number) {
      prismaMock.perfilLiquidacion.findMany.mockResolvedValue([PERFIL_POR_TANTOS]);
      prismaMock.kmPorTantos.findMany.mockResolvedValue([{ cuil: PERFIL_POR_TANTOS.cuil, kmTotal }]);
      prismaMock.tarifaCategoriaUocra.findMany.mockResolvedValue([
        { categoriaUocraId: 1, vigenteDesde: new Date(2026, 7, 1), importeHora: 100 },
      ]);
      // Rangos en orden "al revés" a propósito: el cálculo no puede depender
      // del orden en que Prisma los devuelve.
      prismaMock.rangoKmPorTantos.findMany.mockResolvedValue([...TRES_RANGOS].reverse());
    }

    it.each([
      [59.99, 100], // justo antes de 60: rango 1
      [60, 200], // 60 exacto: rango 2, NO el rango 1
      [74.99, 200], // justo antes de 75: rango 2
      [75, 200], // 75 exacto: rango 2, NO el rango 3
      [75.01, 300], // justo después de 75: rango 3
    ])('km=%s usa el precio del rango correcto ($%i/km)', async (km, precioEsperado) => {
      setupConKm(km);
      const [fila] = await service.calcularQuincena(2026, 8, 1);
      expect(fila.montoKmBruto).toBe(km * precioEsperado);
    });
  });

  describe('régimen "fijo" (básico = tarifa × 88, sin horas extra)', () => {
    it('básico = tarifa × 88, sin horas extra sin importar lo declarado', async () => {
      prismaMock.perfilLiquidacion.findMany.mockResolvedValue([
        {
          cuil: '20777777777',
          regimen: 'fijo',
          categoriaUocraId: 1,
          modalidadPago: 'con_descuentos',
          permiteHorasExtra: false,
          empleado: { apellido_nombre: 'FIJO TEST', legajo: 4, cargo: 'Oficial', provincia: 'Córdoba' },
          categoria: { id: 1, nombre: 'Oficial' },
        },
      ]);
      prismaMock.kmPorTantos.findMany.mockResolvedValue([]);
      prismaMock.rangoKmPorTantos.findMany.mockResolvedValue([]);
      prismaMock.tarifaCategoriaUocra.findMany.mockResolvedValue([
        { categoriaUocraId: 1, vigenteDesde: new Date(2026, 7, 1), importeHora: 1000 },
      ]);
      prismaMock.registroHoras.groupBy.mockResolvedValue([{ operarioCuil: '20777777777', _sum: { horas: 20 } }]);

      const [fila] = await service.calcularQuincena(2026, 8, 1);

      expect(fila.horasTotal).toBe(88);
      expect(fila.horasCct).toBe(88);
      expect(fila.horasExtra).toBe(0);
      expect(fila.totalBruto).toBe(88_000);
      expect(fila.montoHorasExtra).toBe(0);
    });
  });

  describe('régimen "fijo_105" (básico = tarifa × 88 + 17,5hs extra SIEMPRE fijas, ver ADR-020)', () => {
    it('105hs totales sin importar lo declarado: 88 de básico + 17,5 de extra con ×1.5', async () => {
      prismaMock.perfilLiquidacion.findMany.mockResolvedValue([
        {
          cuil: '20888888888',
          regimen: 'fijo_105',
          categoriaUocraId: 1,
          modalidadPago: 'con_descuentos',
          permiteHorasExtra: false,
          empleado: { apellido_nombre: 'FIJO 105 TEST', legajo: 6, cargo: 'Oficial', provincia: 'Córdoba' },
          categoria: { id: 1, nombre: 'Oficial' },
        },
      ]);
      prismaMock.kmPorTantos.findMany.mockResolvedValue([]);
      prismaMock.rangoKmPorTantos.findMany.mockResolvedValue([]);
      prismaMock.tarifaCategoriaUocra.findMany.mockResolvedValue([
        { categoriaUocraId: 1, vigenteDesde: new Date(2026, 7, 1), importeHora: 1000 },
      ]);
      // 0 horas declaradas — no debe cambiar nada, "fijo_105" no depende de lo reportado.
      prismaMock.registroHoras.groupBy.mockResolvedValue([]);

      const [fila] = await service.calcularQuincena(2026, 8, 1);

      expect(fila.horasTotal).toBe(105);
      expect(fila.horasCct).toBe(88);
      expect(fila.horasExtra).toBe(17.5);
      expect(fila.totalBruto).toBe(88_000); // básico = tarifa × 88
      expect(fila.montoHorasExtra).toBe(26_250); // 17,5 × 1.000 × 1.5
      expect(fila.montoPresentismo).toBe(17_600); // 20% del básico (88.000), no de las 105hs
    });

    it('sin categoría/tarifa asignada: datoFaltante, sin calcular nada', async () => {
      prismaMock.perfilLiquidacion.findMany.mockResolvedValue([
        {
          cuil: '20888888888',
          regimen: 'fijo_105',
          categoriaUocraId: null,
          modalidadPago: 'con_descuentos',
          permiteHorasExtra: false,
          empleado: { apellido_nombre: 'FIJO 105 SIN CATEGORIA', legajo: 6, cargo: null, provincia: 'Córdoba' },
          categoria: null,
        },
      ]);
      prismaMock.kmPorTantos.findMany.mockResolvedValue([]);
      prismaMock.rangoKmPorTantos.findMany.mockResolvedValue([]);
      prismaMock.tarifaCategoriaUocra.findMany.mockResolvedValue([]);
      prismaMock.registroHoras.groupBy.mockResolvedValue([]);

      const [fila] = await service.calcularQuincena(2026, 8, 1);

      expect(fila.datoFaltante).toBe('Sin categoría UOCRA / tarifa asignada');
      expect(fila.totalBruto).toBe(0);
      expect(fila.montoHorasExtra).toBe(0);
    });
  });

  describe('presentismo y Ausencia (regla 2026-08-18: cualquier estadoHys hace perder presentismo)', () => {
    const PERFIL_JORNALIZADO = {
      cuil: '20444444444',
      regimen: 'jornalizado',
      categoriaUocraId: 1,
      modalidadPago: 'en_b',
      empleado: { apellido_nombre: 'PRESENTISMO TEST', legajo: 5, cargo: 'Oficial', provincia: 'Córdoba' },
      categoria: { id: 1, nombre: 'Oficial' },
    };

    beforeEach(() => {
      prismaMock.perfilLiquidacion.findMany.mockResolvedValue([PERFIL_JORNALIZADO]);
      prismaMock.kmPorTantos.findMany.mockResolvedValue([]);
      prismaMock.tarifaCategoriaUocra.findMany.mockResolvedValue([
        { categoriaUocraId: 1, vigenteDesde: new Date(2026, 7, 1), importeHora: 1000 },
      ]);
      prismaMock.rangoKmPorTantos.findMany.mockResolvedValue([]);
      prismaMock.registroHoras.groupBy.mockResolvedValue([
        { operarioCuil: PERFIL_JORNALIZADO.cuil, _sum: { horas: 80 } },
      ]);
    });

    it('sin novedades: mantiene presentismo', async () => {
      prismaMock.novedad.findMany.mockResolvedValue([]);
      const [fila] = await service.calcularQuincena(2026, 8, 1);
      expect(fila.tienePresentismo).toBe(true);
      expect(fila.montoPresentismo).toBe(fila.totalBruto * 0.2);
    });

    it('Ausencia PENDIENTE (todavía sin resolver por HyS) también hace perder presentismo', async () => {
      prismaMock.novedad.findMany.mockResolvedValue([
        {
          operarioCuil: PERFIL_JORNALIZADO.cuil,
          tipoNovedadId: 5,
          fechaInicio: new Date(2026, 7, 2),
          fechaFin: new Date(2026, 7, 2),
          estadoHys: 'pendiente',
          estado: 'activa',
          tipoNovedad: { nombre: 'Ausencia' },
        },
      ]);
      const [fila] = await service.calcularQuincena(2026, 8, 1);
      expect(fila.tienePresentismo).toBe(false);
      expect(fila.montoPresentismo).toBe(0);
    });

    it('Ausencia APROBADA (justificada) también hace perder presentismo (cambio de regla)', async () => {
      prismaMock.novedad.findMany.mockResolvedValue([
        {
          operarioCuil: PERFIL_JORNALIZADO.cuil,
          tipoNovedadId: 5,
          fechaInicio: new Date(2026, 7, 2),
          fechaFin: new Date(2026, 7, 2),
          estadoHys: 'aprobada',
          estado: 'activa',
          tipoNovedad: { nombre: 'Ausencia' },
        },
      ]);
      const [fila] = await service.calcularQuincena(2026, 8, 1);
      expect(fila.tienePresentismo).toBe(false);
      expect(fila.montoPresentismo).toBe(0);
    });

    it('Ausencia DESAPROBADA (injustificada) sigue haciendo perder presentismo (sin cambios)', async () => {
      prismaMock.novedad.findMany.mockResolvedValue([
        {
          operarioCuil: PERFIL_JORNALIZADO.cuil,
          tipoNovedadId: 5,
          fechaInicio: new Date(2026, 7, 2),
          fechaFin: new Date(2026, 7, 2),
          estadoHys: 'desaprobada',
          estado: 'activa',
          tipoNovedad: { nombre: 'Ausencia' },
        },
      ]);
      const [fila] = await service.calcularQuincena(2026, 8, 1);
      expect(fila.tienePresentismo).toBe(false);
      expect(fila.montoPresentismo).toBe(0);
    });

    it('Suspensión sigue haciendo perder presentismo (sin cambios)', async () => {
      prismaMock.novedad.findMany.mockResolvedValue([
        {
          operarioCuil: PERFIL_JORNALIZADO.cuil,
          tipoNovedadId: 6,
          fechaInicio: new Date(2026, 7, 2),
          fechaFin: new Date(2026, 7, 2),
          estadoHys: 'no_aplica',
          estado: 'activa',
          tipoNovedad: { nombre: 'Suspensión' },
        },
      ]);
      const [fila] = await service.calcularQuincena(2026, 8, 1);
      expect(fila.tienePresentismo).toBe(false);
      expect(fila.montoPresentismo).toBe(0);
    });

    it('Ausencia ANULADA no se trae de la query (where filtra estado: activa) y no hace perder presentismo', async () => {
      // Simula lo que Prisma devolvería en producción: la anulada nunca llega
      // porque el where ya filtra estado: 'activa'.
      prismaMock.novedad.findMany.mockResolvedValue([]);

      const [fila] = await service.calcularQuincena(2026, 8, 1);

      expect(fila.tienePresentismo).toBe(true);
      expect(fila.montoPresentismo).toBe(fila.totalBruto * 0.2);
      const where = prismaMock.novedad.findMany.mock.calls[0][0].where;
      expect(where.estado).toBe('activa');
    });
  });

  describe('régimen "mensualizado" (ADR-016 — sueldo vigente, no por quincena exacta)', () => {
    const PERFIL_MENSUALIZADO = {
      cuil: '20888888888',
      regimen: 'mensualizado',
      categoriaUocraId: null,
      modalidadPago: null,
      empleado: { apellido_nombre: 'MENSUAL TEST', legajo: 3, cargo: 'Administrativo', provincia: 'Córdoba' },
      categoria: null,
    };

    beforeEach(() => {
      prismaMock.perfilLiquidacion.findMany.mockResolvedValue([PERFIL_MENSUALIZADO]);
      prismaMock.kmPorTantos.findMany.mockResolvedValue([]);
      prismaMock.tarifaCategoriaUocra.findMany.mockResolvedValue([]);
      prismaMock.rangoKmPorTantos.findMany.mockResolvedValue([]);
    });

    it('sin fila EXACTA del período: datoFaltante, no arrastra el sueldo de un mes anterior (ADR-018)', async () => {
      // La query real filtra por vigenteDesde exacto — el mock simula lo que
      // Prisma devolvería: ninguna fila coincide con agosto (solo hay julio).
      prismaMock.sueldoMensualizado.findMany.mockResolvedValue([]);
      const [fila] = await service.calcularQuincena(2026, 8, 1);

      expect(fila.datoFaltante).toBe('Falta cargar el sueldo mensualizado (Tarifas > Sueldos mensualizados)');
      expect(fila.totalBruto).toBe(0);
    });

    it('con fila exacta del período: la usa sin importar valores de otros meses', async () => {
      prismaMock.sueldoMensualizado.findMany.mockResolvedValue([
        { cuil: PERFIL_MENSUALIZADO.cuil, vigenteDesde: new Date(2026, 7, 1), monto: 550_000 }, // agosto exacto
      ]);
      const [fila] = await service.calcularQuincena(2026, 8, 1);

      expect(fila.horasTotal).toBe(1);
      expect(fila.horasCct).toBe(1);
      expect(fila.horasExtra).toBe(0);
      expect(fila.totalBruto).toBe(550_000);
      expect(fila.montoHorasExtra).toBe(0);
      expect(fila.datoFaltante).toBeNull();
    });

    it('sin ningún sueldo vigente cargado todavía: datoFaltante, básico en 0', async () => {
      prismaMock.sueldoMensualizado.findMany.mockResolvedValue([]);
      const [fila] = await service.calcularQuincena(2026, 8, 1);

      expect(fila.datoFaltante).toBe('Falta cargar el sueldo mensualizado (Tarifas > Sueldos mensualizados)');
      expect(fila.totalBruto).toBe(0);
    });

    it('ignora la categoría UOCRA asignada (no la necesita, aunque el empleado tenga una)', async () => {
      prismaMock.perfilLiquidacion.findMany.mockResolvedValue([
        { ...PERFIL_MENSUALIZADO, categoriaUocraId: 4, categoria: { id: 4, nombre: 'Ayudante' } },
      ]);
      prismaMock.sueldoMensualizado.findMany.mockResolvedValue([
        { cuil: PERFIL_MENSUALIZADO.cuil, vigenteDesde: new Date(2026, 7, 1), monto: 600_000 },
      ]);
      const [fila] = await service.calcularQuincena(2026, 8, 1);

      expect(fila.totalBruto).toBe(600_000);
      expect(fila.datoFaltante).toBeNull();
    });

    describe('permiteHorasExtra (ADR-017 — caso real: mensualizado que también cobra extras)', () => {
      beforeEach(() => {
        prismaMock.sueldoMensualizado.findMany.mockResolvedValue([
          { cuil: PERFIL_MENSUALIZADO.cuil, vigenteDesde: new Date(2026, 7, 1), monto: 500_000 },
        ]);
        prismaMock.tarifaCategoriaUocra.findMany.mockResolvedValue([
          { categoriaUocraId: 1, vigenteDesde: new Date(2026, 7, 1), importeHora: 1000 },
        ]);
      });

      it('con el flag: lo declarado ES la hora extra directamente (sin restar nada), básico intacto', async () => {
        prismaMock.perfilLiquidacion.findMany.mockResolvedValue([
          { ...PERFIL_MENSUALIZADO, categoriaUocraId: 1, categoria: { id: 1, nombre: 'Oficial' }, permiteHorasExtra: true },
        ]);
        // El operario declaró 5hs por Reporte diario — son 5hs EXTRA, su jornal nunca se carga.
        prismaMock.registroHoras.groupBy.mockResolvedValue([{ operarioCuil: PERFIL_MENSUALIZADO.cuil, _sum: { horas: 5 } }]);

        const [fila] = await service.calcularQuincena(2026, 8, 1);

        expect(fila.horasCct).toBe(1);
        expect(fila.horasExtra).toBe(5); // no se resta nada, lo declarado ya es el extra
        expect(fila.montoHorasExtra).toBe(7_500); // 5 × 1000 × 1.5
        expect(fila.totalBruto).toBe(500_000); // básico (monto fijo) sin cambios
        expect(fila.horasTotal).toBe(6); // 1 (formalismo de mensualizado) + 5
        expect(fila.datoFaltante).toBeNull();
      });

      it('sin el flag: mismo perfil, ignora lo declarado (comportamiento actual sin cambios)', async () => {
        prismaMock.perfilLiquidacion.findMany.mockResolvedValue([
          { ...PERFIL_MENSUALIZADO, categoriaUocraId: 1, categoria: { id: 1, nombre: 'Oficial' }, permiteHorasExtra: false },
        ]);
        prismaMock.registroHoras.groupBy.mockResolvedValue([{ operarioCuil: PERFIL_MENSUALIZADO.cuil, _sum: { horas: 5 } }]);

        const [fila] = await service.calcularQuincena(2026, 8, 1);

        expect(fila.horasTotal).toBe(1);
        expect(fila.horasExtra).toBe(0);
        expect(fila.montoHorasExtra).toBe(0);
        expect(fila.totalBruto).toBe(500_000);
      });

      it('con el flag pero sin categoría/tarifa asignada: datoFaltante puntual del extra, básico intacto', async () => {
        prismaMock.perfilLiquidacion.findMany.mockResolvedValue([
          { ...PERFIL_MENSUALIZADO, categoriaUocraId: null, categoria: null, permiteHorasExtra: true },
        ]);
        prismaMock.tarifaCategoriaUocra.findMany.mockResolvedValue([]);
        prismaMock.registroHoras.groupBy.mockResolvedValue([{ operarioCuil: PERFIL_MENSUALIZADO.cuil, _sum: { horas: 5 } }]);

        const [fila] = await service.calcularQuincena(2026, 8, 1);

        expect(fila.datoFaltante).toBe('Sin categoría UOCRA / tarifa asignada (necesaria para las horas extra)');
        expect(fila.horasExtra).toBe(5); // se calcula igual, solo falta convertirlo a $
        expect(fila.montoHorasExtra).toBe(0);
        expect(fila.totalBruto).toBe(500_000); // el básico (monto fijo) no depende de la categoría
      });

      it('con el flag pero sin sueldo vigente: prioriza el datoFaltante del sueldo (más bloqueante)', async () => {
        prismaMock.sueldoMensualizado.findMany.mockResolvedValue([]);
        prismaMock.perfilLiquidacion.findMany.mockResolvedValue([
          { ...PERFIL_MENSUALIZADO, categoriaUocraId: 1, categoria: { id: 1, nombre: 'Oficial' }, permiteHorasExtra: true },
        ]);
        prismaMock.registroHoras.groupBy.mockResolvedValue([{ operarioCuil: PERFIL_MENSUALIZADO.cuil, _sum: { horas: 5 } }]);

        const [fila] = await service.calcularQuincena(2026, 8, 1);

        expect(fila.datoFaltante).toBe('Falta cargar el sueldo mensualizado (Tarifas > Sueldos mensualizados)');
        expect(fila.totalBruto).toBe(0);
        expect(fila.montoHorasExtra).toBe(7_500); // el extra sí se puede calcular, no depende del sueldo
      });
    });
  });

  describe('precios por período, sin arrastre (ADR-018)', () => {
    const PERFIL_JORNALIZADO = {
      cuil: '20444444444',
      regimen: 'jornalizado',
      categoriaUocraId: 1,
      modalidadPago: 'en_b',
      empleado: { apellido_nombre: 'PRECIOS TEST', legajo: 5, cargo: 'Oficial', provincia: 'Córdoba' },
      categoria: { id: 1, nombre: 'Oficial' },
    };

    beforeEach(() => {
      prismaMock.perfilLiquidacion.findMany.mockResolvedValue([PERFIL_JORNALIZADO]);
      prismaMock.kmPorTantos.findMany.mockResolvedValue([]);
      prismaMock.tarifaCategoriaUocra.findMany.mockResolvedValue([
        { categoriaUocraId: 1, vigenteDesde: new Date(2026, 7, 1), importeHora: 1000 },
      ]);
      prismaMock.rangoKmPorTantos.findMany.mockResolvedValue([]);
      prismaMock.registroHoras.groupBy.mockResolvedValue([{ operarioCuil: PERFIL_JORNALIZADO.cuil, _sum: { horas: 80 } }]);
    });

    it('bono de un mes anterior NO se arrastra: sin fila exacta, noRemunerativo=0 y sin datoFaltante (es opcional)', async () => {
      prismaMock.bonoNoRemunerativo.findMany.mockResolvedValue([]); // simula lo que Prisma filtraría (agosto exacto)
      const [fila] = await service.calcularQuincena(2026, 8, 1);

      expect(fila.noRemunerativo).toBe(0);
      expect(fila.datoFaltante).toBeNull(); // opcional: sin fila no alerta
    });

    it('bono con fila exacta del período: se aplica', async () => {
      prismaMock.bonoNoRemunerativo.findMany.mockResolvedValue([
        { categoriaUocraId: 1, vigenteDesde: new Date(2026, 7, 1), tipo: 'monto_fijo', valor: 33550 },
      ]);
      const [fila] = await service.calcularQuincena(2026, 8, 1);
      expect(fila.noRemunerativo).toBe(33550);
    });

    it('novedad con plus pero sin monto vigente del período: datoFaltante, monto en 0', async () => {
      prismaMock.tipoNovedad.findMany.mockResolvedValue([{ id: 5, nombre: 'Guardia Pasiva', generaPlus: true }]);
      prismaMock.novedad.findMany.mockResolvedValue([
        {
          operarioCuil: PERFIL_JORNALIZADO.cuil,
          tipoNovedadId: 5,
          fechaInicio: new Date(2026, 7, 2),
          fechaFin: new Date(2026, 7, 2),
          estadoHys: 'no_aplica',
          estado: 'activa',
          tipoNovedad: { nombre: 'Guardia Pasiva' },
        },
      ]);
      prismaMock.montoNovedadPlus.findMany.mockResolvedValue([]); // sin fila del período exacto

      const [fila] = await service.calcularQuincena(2026, 8, 1);
      expect(fila.datoFaltante).toBe('Falta cargar el monto de "Guardia Pasiva" de este período (Tarifas > Precios)');
      expect(fila.plus[0].monto).toBe(0);
    });

    it('plus individual: se suma al total, con su motivo', async () => {
      prismaMock.plusIndividual.findMany.mockResolvedValue([
        { cuil: PERFIL_JORNALIZADO.cuil, monto: 15000, motivo: 'Manejo de máquina X' },
      ]);
      const [fila] = await service.calcularQuincena(2026, 8, 1);

      expect(fila.plusIndividual).toBe(15000);
      expect(fila.plusIndividualMotivo).toBe('Manejo de máquina X');
      expect(fila.total).toBe(fila.totalBruto + fila.montoHorasExtra + fila.montoPresentismo + 15000);
    });

    it('sin plus individual cargado: null, no afecta el total', async () => {
      const [fila] = await service.calcularQuincena(2026, 8, 1);
      expect(fila.plusIndividual).toBeNull();
      expect(fila.plusIndividualMotivo).toBeNull();
    });
  });
});
