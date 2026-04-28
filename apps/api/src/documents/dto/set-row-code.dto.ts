import { IsString, Matches } from 'class-validator';

export class SetRowCodeDto {
  /** 10-значный код ТН ВЭД, который оператор хочет установить в строку. */
  @IsString()
  @Matches(/^\d{10}$/, { message: 'tnVedCode must be exactly 10 digits' })
  tnVedCode: string;
}
