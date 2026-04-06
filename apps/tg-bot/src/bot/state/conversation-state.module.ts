import { Global, Module } from '@nestjs/common';
import { ConversationStateService } from './conversation-state.service';

@Global()
@Module({
  providers: [ConversationStateService],
  exports: [ConversationStateService],
})
export class ConversationStateModule {}
