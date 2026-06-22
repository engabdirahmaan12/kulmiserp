'use client';

import { useAuthBootstrap } from '@/lib/hooks/useAuth';

export function AuthBootstrap({ children }: { children: React.ReactNode }) {
  useAuthBootstrap();
  return children;
}
