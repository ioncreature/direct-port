import { Module } from '@nestjs/common';
import { ConversationStateService } from './conversation-state.service';

@Module({
  providers: [ConversationStateService],
  exports: [ConversationStateService],
})
export class ConversationStateModule {}
