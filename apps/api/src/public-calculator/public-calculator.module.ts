import { Module } from '@nestjs/common';
import { CalculatorModule } from '../calculator/calculator.module';
import { CurrencyModule } from '../currency/currency.module';
import { TnVedModule } from '../tn-ved/tn-ved.module';
import { PublicCalculatorController } from './public-calculator.controller';
import { PublicCalculatorService } from './public-calculator.service';

@Module({
  imports: [TnVedModule, CalculatorModule, CurrencyModule],
  controllers: [PublicCalculatorController],
  providers: [PublicCalculatorService],
})
export class PublicCalculatorModule {}
