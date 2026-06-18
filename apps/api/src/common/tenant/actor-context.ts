import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '../../database/entities/user.entity';
import { ErrorCode } from '../error-codes';

/**
 * Текущий пользователь запроса (форма req.user из JwtStrategy.validate). Используется
 * как единый «actor» для tenant-изоляции: контроллеры передают его в сервисы, сервисы
 * скоупят данные по компании через хелперы ниже.
 */
export interface Actor {
  id: string;
  role: UserRole;
  companyId: string | null;
}

/**
 * Вычисляет фильтр по компании для листингов/агрегаций.
 * - super_admin без `requested` → `undefined` (без фильтра — видит все компании);
 * - super_admin с `requested` → конкретная компания (выбор в UI);
 * - admin/customs → всегда своя компания (`requested` игнорируется — защита от подмены),
 *   а если компании нет → 403 (fail-closed; в норме не случается, кроме старого JWT).
 */
export function resolveCompanyScope(actor: Actor, requested?: string | null): string | undefined {
  if (actor.role === UserRole.SUPER_ADMIN) {
    return requested ?? undefined;
  }
  if (!actor.companyId) {
    throw new ForbiddenException('User is not assigned to a company');
  }
  return actor.companyId;
}

/**
 * Проверяет, что сущность принадлежит компании актора. super_admin проходит всегда.
 * При несовпадении бросает 404 (а не 403) — чтобы не раскрывать существование чужой записи.
 */
export function assertSameCompany(actor: Actor, entityCompanyId: string | null): void {
  if (actor.role === UserRole.SUPER_ADMIN) return;
  if (!actor.companyId || entityCompanyId !== actor.companyId) {
    throw new NotFoundException({ code: ErrorCode.UNKNOWN_ROW, message: 'Resource not found' });
  }
}
