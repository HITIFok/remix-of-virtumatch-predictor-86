import { useEffect, useState, useCallback } from 'react';
import { restoreDeviceId, getDeviceId, initDeviceAuth } from '@/lib/device';
import { Loader2 } from 'lucide-react';

interface DeviceIdRestorerProps {
  children: React.ReactNode;
  onRestored?: () => void; // callback when device ID is restored from IDB
}

/**
 * Restores device_id from IndexedDB backup at app startup.
 * If localStorage was cleared (browser restart, cache clear), this component:
 * 1. Reads device_id from IndexedDB
 * 2. Restores it to localStorage
 * 3. Calls onRestored() so the parent can reload data (predictions, premium, etc.)
 *
 * IMPORTANT: This component is BLOCKING — it waits for restoreDeviceId()
 * before rendering children. This prevents PremiumGate from calling verifyPremium()
 * with a temporary fingerprint instead of the real stored device_id.
 */
export function DeviceIdRestorer({ children, onRestored }: DeviceIdRestorerProps) {
  const [ready, setReady] = useState(false);

  const doRestore = useCallback(async () => {
    try {
      // Check localStorage first — if it has an ID, no need to wait for IDB
      const lsId = localStorage.getItem("virtuxxs_device_id");
      if (lsId && lsId.startsWith('dev-')) {
        // localStorage already has device_id — good to go
        getDeviceId(); // warm the cache
        // Pre-register for HMAC auth (non-blocking for UX)
        initDeviceAuth().catch(() => {});
        setReady(true);
        return;
      }

      // localStorage is empty — try to restore from IndexedDB
      // This MUST complete before any API calls happen
      const restoredId = await restoreDeviceId();
      if (restoredId) {
        console.log(`[DeviceIdRestorer] Restored device ID, reloading data...`);
        onRestored?.();
      }
      // Pre-register for HMAC auth
      initDeviceAuth().catch(() => {});
    } catch (err) {
      console.warn('[DeviceIdRestorer] Restore failed:', err);
    } finally {
      setReady(true);
    }
  }, [onRestored]);

  useEffect(() => {
    doRestore();
  }, [doRestore]);

  // Block rendering until device_id is resolved
  // This prevents PremiumGate from calling verifyPremium() with a wrong device_id
  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-muted-foreground" size={24} />
      </div>
    );
  }

  return <>{children}</>;
}
