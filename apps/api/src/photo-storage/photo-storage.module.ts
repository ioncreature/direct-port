import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentPhoto } from '../database/entities/document-photo.entity';
import { PhotoStorageService } from './photo-storage.service';

@Module({
  imports: [TypeOrmModule.forFeature([DocumentPhoto])],
  providers: [PhotoStorageService],
  exports: [PhotoStorageService],
})
export class PhotoStorageModule {}
