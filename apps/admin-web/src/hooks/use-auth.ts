'use client';

import { use } from 'react';
import { AuthContext } from '@/components/auth-provider';

export function useAuth() {
  return use(AuthContext);
}
