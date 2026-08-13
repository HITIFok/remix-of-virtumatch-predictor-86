import { useState, useEffect, useCallback, useRef } from "react";
import { config } from "@/config/env";

interface DeviceInfo {
  device_id: string;
  total_predictions: number;
  pending: number;
  correct: number;
  incorrect: number;
  first_prediction: string | null;
  last_prediction: string | null;
}

interface PremiumActivation {
  device_id: string;
  activated_at: string;
  expires_at: string;
}

interface AdminDeviceIdsResult {
  devices: DeviceInfo[];
  activations: PremiumActivation[];
  total_devices: number;
}

export function useAdminDeviceIds() {
  const [deviceIds, setDeviceIds] = useState<string[]>([]);
  const [deviceInfos, setDeviceInfos] = useState<DeviceInfo[]>([]);
  const [activations, setActivations] = useState<PremiumActivation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<AdminDeviceIdsResult | null>(null);
  const fetchedRef = useRef(false);

  const fetchDeviceIds = useCallback(async (useCache = true) => {
    // Return cache if available and requested
    if (useCache && cacheRef.current) {
      setDeviceIds(cacheRef.current.devices.map(d => d.device_id));
      setDeviceInfos(cacheRef.current.devices);
      setActivations(cacheRef.current.activations);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const adminToken = localStorage.getItem("virtuxxs_admin_session");
      const token = adminToken ? JSON.parse(adminToken).token : "";

      const res = await fetch(`${config.api.adminCodes}?action=migrate`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        // Silently fail on 401 — session may not be verified yet
        if (res.status === 401) {
          setLoading(false);
          return;
        }
        throw new Error(`Erreur ${res.status}`);
      }

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Erreur serveur");
      }

      const result: AdminDeviceIdsResult = {
        devices: data.devices || [],
        activations: data.activations || [],
        total_devices: data.total_devices || 0,
      };

      cacheRef.current = result;
      fetchedRef.current = true;
      setDeviceIds(result.devices.map(d => d.device_id));
      setDeviceInfos(result.devices);
      setActivations(result.activations);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-fetch on mount (will silently fail if 401, then refetch after session verification)
  useEffect(() => {
    fetchDeviceIds();
  }, [fetchDeviceIds]);

  // Helper: check if a device has premium
  const getPremiumInfo = useCallback(
    (deviceId: string): PremiumActivation | undefined => {
      return activations.find(a => a.device_id === deviceId);
    },
    [activations]
  );

  // Helper: get device info
  const getDeviceInfo = useCallback(
    (deviceId: string): DeviceInfo | undefined => {
      return deviceInfos.find(d => d.device_id === deviceId);
    },
    [deviceInfos]
  );

  return {
    deviceIds,
    deviceInfos,
    activations,
    loading,
    error,
    fetched: fetchedRef.current,
    refetch: () => fetchDeviceIds(false), // Force refresh, bypass cache
    getPremiumInfo,
    getDeviceInfo,
  };
}
