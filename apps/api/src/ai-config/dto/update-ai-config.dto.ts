import { IsIn, IsOptional } from 'class-validator';

const TIERS = ['opus', 'sonnet', 'haiku'] as const;

export class UpdateAiConfigDto {
  @IsOptional()
  @IsIn(TIERS)
  parserModel?: 'opus' | 'sonnet' | 'haiku';

  @IsOptional()
  @IsIn(TIERS)
  classifierModel?: 'opus' | 'sonnet' | 'haiku';

  @IsOptional()
  @IsIn(TIERS)
  interpreterModel?: 'opus' | 'sonnet' | 'haiku';
}
