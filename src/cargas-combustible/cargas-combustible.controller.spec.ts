import 'reflect-metadata';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { CargasCombustibleController } from './cargas-combustible.controller';

// TEMPORAL: mientras dure el gating Admin-only (spec 2026-08-03), estos 8 handlers
// deben tener @Roles('Admin') exactamente. Ver comentario en el controller.
describe('CargasCombustibleController — metadata de roles (gating Admin-only)', () => {
  const handlers = ['crear', 'extraerTicket', 'ultimoKm', 'listar', 'detalle', 'ticket', 'editar', 'anular'] as const;

  it.each(handlers)('%s tiene @Roles exactamente [\'Admin\']', (handler) => {
    const roles = Reflect.getMetadata(ROLES_KEY, CargasCombustibleController.prototype[handler]);
    expect(roles).toEqual(['Admin']);
  });
});
