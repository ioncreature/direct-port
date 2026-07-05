import type { UserRole } from './types';

/** Человекочитаемые русские названия ролей — единый источник для таблиц, фильтров и форм. */
export const roleLabels: Record<UserRole, string> = {
  super_admin: 'Глобальный администратор',
  admin: 'Администратор',
  customs: 'Декларант',
};

export function roleLabel(role: string): string {
  return roleLabels[role as UserRole] ?? role;
}

/**
 * Роли с админ-доступом: видят пользователей, AI-расходы, настройки.
 * Единый источник для навигации и ролевого гейтинга дашборда.
 * Telegram-пользователи и документы доступны шире (в т.ч. роли customs) —
 * там изоляция обеспечивается скоупом по компании на бэке, а не этим списком.
 */
export const ADMIN_ROLES: readonly string[] = ['admin', 'super_admin'];

export function isAdminRole(role: string | null | undefined): boolean {
  return role != null && ADMIN_ROLES.includes(role);
}
