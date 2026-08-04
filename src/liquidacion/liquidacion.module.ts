import { Module } from '@nestjs/common';
import { LiquidacionService } from './liquidacion.service';
import { CalculoService } from './calculo.service';
import { PanelService } from './panel.service';
import { LiquidacionController } from './liquidacion.controller';

@Module({
  providers: [LiquidacionService, CalculoService, PanelService],
  controllers: [LiquidacionController],
})
export class LiquidacionModule {}
