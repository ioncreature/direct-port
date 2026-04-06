import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TnVedCode } from '../database/entities/tn-ved-code.entity';
import { TnVedController } from './tn-ved.controller';
import { TnVedService } from './tn-ved.service';

@Module({
  imports: [TypeOrmModule.forFeature([TnVedCode])],
  controllers: [TnVedController],
  providers: [TnVedService],
  exports: [TnVedService],
})
export class TnVedModule {}
