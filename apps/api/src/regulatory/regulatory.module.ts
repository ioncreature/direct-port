import { Module } from '@nestjs/common';
import { CountriesModule } from '../countries/countries.module';
import { RegulatoryRequirementsService } from './regulatory-requirements.service';

@Module({
  imports: [CountriesModule],
  providers: [RegulatoryRequirementsService],
  exports: [RegulatoryRequirementsService],
})
export class RegulatoryModule {}
