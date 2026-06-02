import { IsIn, IsInt, IsOptional, IsString, IsUUID } from 'class-validator';
import type { ConversationAttachmentType } from '../../database/entities/conversation-message.entity';

export class IntakeMessageDto {
  @IsUUID()
  telegramUserId: string;

  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsIn(['document', 'photo', 'file'])
  attachmentType?: ConversationAttachmentType;

  @IsOptional()
  @IsString()
  attachmentFileId?: string;

  @IsOptional()
  @IsInt()
  telegramMessageId?: number;
}
