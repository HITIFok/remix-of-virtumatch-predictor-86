import { useEffect, useState, useCallback } from 'react';
import { restoreDeviceId, getDeviceId } from '@/lib/device';

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
 * Non-blocking: renders children immediately, restores in background.
 */
export function DeviceIdRestorer({ children, onRestored }: DeviceIdRestorerProps) {
  const [done, setDone] = useState(false);

  const doRestore = useCallback(async () => {
    try {
      const restoredId = await restoreDeviceId();
      if (restoredId) {
        console.log(`[DeviceIdRestorer] Restored device ID, reloading data...`);
        onRestored?.();
      }
    } catch (err) {
      console.warn('[DeviceIdRestorer] Restore failed:', err);
    } finally {
      setDone(true);
    }
  }, [onRestored]);

  useEffect(() => {
    // Only restore if localStorage is empty (no cached ID)
    try {
      const lsId = localStorage.getItem("virtuxxs_device_id");
      if (lsId) {
        setDone(true); // localStorage has ID, no need to restore
        return;
      }
    } catch { /* no localStorage — definitely need restore */ }

    doRestore();
  }, [doRestore]);

  return <>{children}</>;
}
