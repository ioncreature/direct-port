import { Module } from '@nestjs/common';
import { TksModule } from '../tks/tks.module';
import { ClassifierService } from './classifier.service';

@Module({
  imports: [TksModule],
  providers: [ClassifierService],
  exports: [ClassifierService],
})
export class ClassifierModule {}
