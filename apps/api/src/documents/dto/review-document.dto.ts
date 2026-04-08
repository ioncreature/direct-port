import { ArrayMinSize, IsArray, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ParsedDataRowDto {
  @IsString()
  description: string;

  @IsNumber()
  quantity: number;

  @IsNumber()
  price: number;

  @IsNumber()
  weight: number;
}

export class ReviewDocumentDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ParsedDataRowDto)
  parsedData: ParsedDataRowDto[];

  @IsOptional()
  @IsString()
  currency?: string;
}
