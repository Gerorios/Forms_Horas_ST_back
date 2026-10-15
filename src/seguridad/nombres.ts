import { PrismaService } from '../prisma/prisma.service';

/** CUIL → nombre para mostrar: nómina (snuempleados) y, para quien no está
 * en ella, `Usuario.nombreFueraNomina` (ADR-008). Mismo criterio que
 * novedades.service.ts; la consulta extra corre solo si falta alguno. */
export async function mapaNombres(prisma: PrismaService, cuils: Iterable<string>): Promise<Map<string, string>> {
  const unicos = [...new Set(cuils)];
  if (unicos.length === 0) return new Map();
  const empleados = await prisma.snuempleados.findMany({
    where: { cuil: { in: unicos } },
    select: { cuil: true, apellido_nombre: true },
  });
  const mapa = new Map(empleados.map((e) => [e.cuil, e.apellido_nombre.trim()]));
  const faltantes = unicos.filter((c) => !mapa.get(c));
  if (faltantes.length > 0) {
    const usuarios = await prisma.usuario.findMany({
      where: { cuil: { in: faltantes } },
      select: { cuil: true, nombreFueraNomina: true },
    });
    for (const u of usuarios) if (u.nombreFueraNomina) mapa.set(u.cuil, u.nombreFueraNomina);
  }
  return mapa;
}
