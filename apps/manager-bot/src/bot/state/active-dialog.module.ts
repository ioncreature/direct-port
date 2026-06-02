import { Module } from '@nestjs/common';
import { ActiveDialogService } from './active-dialog.service';

@Module({
  providers: [ActiveDialogService],
  exports: [ActiveDialogService],
})
export class ActiveDialogModule {}
