import { Injectable } from '@nestjs/common';
import { normalizeOksmtCode } from '../common/oksmt';
import { OKSMT_BY_CODE, OKSMT_SORTED_BY_NAME_RU, type OksmtCountry } from './oksmt.data';

/**
 * Справочник стран мира. Данные зашиты статически в oksmt.data.ts — это
 * государственный классификатор, меняется крайне редко, а зависимость от
 * внешнего TKS API на этапе рендера списка стран была лишней.
 */
@Injectable()
export class CountriesService {
  async listAll(): Promise<readonly OksmtCountry[]> {
    return OKSMT_SORTED_BY_NAME_RU;
  }

  async findByCode(code: string | null | undefined): Promise<OksmtCountry | null> {
    const normalized = normalizeOksmtCode(code);
    if (!normalized) return null;
    return OKSMT_BY_CODE.get(normalized) ?? null;
  }
}
