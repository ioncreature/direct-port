import { IsIn, IsOptional } from 'class-validator';
import type { AiModelTier } from '../../database/entities/ai-config.entity';

const TIERS = ['opus', 'sonnet', 'haiku'] as const;

export class UpdateAiConfigDto {
  @IsOptional()
  @IsIn(TIERS)
  parserModel?: AiModelTier;

  @IsOptional()
  @IsIn(TIERS)
  queryFormulationModel?: AiModelTier;

  @IsOptional()
  @IsIn(TIERS)
  classifierModel?: AiModelTier;

  @IsOptional()
  @IsIn(TIERS)
  interpreterModel?: AiModelTier;
}
