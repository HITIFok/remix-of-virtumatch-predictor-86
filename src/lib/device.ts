// Shared device ID utility — avoids circular dependency between storage.ts and hooks

export function getDeviceId(): string {
  try {
    let id = localStorage.getItem("virtuxxs_device_id");
    if (!id) {
      id = `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem("virtuxxs_device_id", id);
    }
    return id;
  } catch {
    return 'unknown';
  }
}
