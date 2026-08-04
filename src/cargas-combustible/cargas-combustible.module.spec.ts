import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CargasCombustibleModule } from './cargas-combustible.module';
import { CargasCombustibleService } from './cargas-combustible.service';
import { ExtraccionTicketService } from './extraccion-ticket.service';
import { TICKET_STORAGE } from './storage/ticket-storage.interface';
import { PrismaService } from '../prisma/prisma.service';

// PrismaModule real es @Global(), pero al importar solo CargasCombustibleModule
// (aislado, sin AppModule) ese scope global no aplica. Este stub replica el
// mismo shape de módulo global exportando un PrismaService fake, para que la
// resolución de dependencias del módulo real bajo prueba funcione igual que
// en producción sin necesitar una BD real.
@Global()
@Module({
  providers: [{ provide: PrismaService, useValue: {} }],
  exports: [PrismaService],
})
class PrismaTestModule {}

describe('CargasCombustibleModule (DI)', () => {
  it('compila el módulo real y resuelve todos sus providers', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaTestModule, CargasCombustibleModule],
    }).compile();

    expect(moduleRef.get(CargasCombustibleService)).toBeDefined();
    expect(moduleRef.get(ExtraccionTicketService)).toBeDefined();
    expect(moduleRef.get(TICKET_STORAGE)).toBeDefined();
  });
});
