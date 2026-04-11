'use client';

import { AuthContext } from '@/components/auth-provider';
import { use } from 'react';

export function useAuth() {
  return use(AuthContext);
}
