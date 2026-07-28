import { Module } from '@nestjs/common';
import { LiquidacionService } from './liquidacion.service';
import { LiquidacionController } from './liquidacion.controller';

@Module({
  providers: [LiquidacionService],
  controllers: [LiquidacionController],
})
export class LiquidacionModule {}
