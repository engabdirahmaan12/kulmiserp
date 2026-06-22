'use client';

import { useEffect } from 'react';
import { usePosStore } from '@/lib/stores/pos';

export function ServiceWorkerRegistration() {
  const syncOfflineSales = usePosStore((s) => s.syncOfflineSales);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    // Only register service worker in production to avoid redirect issues in dev
    if (process.env.NODE_ENV !== 'production') return;

    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        console.log('[SW] Registered:', registration.scope);
      })
      .catch((err) => {
        console.warn('[SW] Registration failed:', err);
      });

    // Listen for sync messages from service worker
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'SYNC_OFFLINE_SALES') {
        syncOfflineSales();
      }
    });

    // Auto-sync when coming back online
    const handleOnline = () => {
      syncOfflineSales();
      if ('serviceWorker' in navigator && 'SyncManager' in window) {
        navigator.serviceWorker.ready
          .then((reg) => (reg as ServiceWorkerRegistration & { sync: { register: (tag: string) => Promise<void> } }).sync.register('sync-offline-sales'))
          .catch(() => {});
      }
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [syncOfflineSales]);

  return null;
}
