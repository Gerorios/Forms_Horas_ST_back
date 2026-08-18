import { Module } from '@nestjs/common';
import { LiquidacionService } from './liquidacion.service';
import { CalculoService } from './calculo.service';
import { PanelService } from './panel.service';
import { AnalisisService } from './analisis.service';
import { LiquidacionController } from './liquidacion.controller';

@Module({
  providers: [LiquidacionService, CalculoService, PanelService, AnalisisService],
  controllers: [LiquidacionController],
  // CalculoService también lo usa NovedadesService (resumen-ausencias, ver
  // ADR de esa feature) para clipear días de Ausencia a la quincena.
  exports: [CalculoService],
})
export class LiquidacionModule {}
