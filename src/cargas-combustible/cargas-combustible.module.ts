import { Module } from '@nestjs/common';
import { CargasCombustibleController } from './cargas-combustible.controller';
import { CargasCombustibleService } from './cargas-combustible.service';
import { FsTicketStorage } from './storage/fs-ticket-storage.service';
import { TICKET_STORAGE } from './storage/ticket-storage.interface';

@Module({
  controllers: [CargasCombustibleController],
  providers: [CargasCombustibleService, { provide: TICKET_STORAGE, useClass: FsTicketStorage }],
})
export class CargasCombustibleModule {}
