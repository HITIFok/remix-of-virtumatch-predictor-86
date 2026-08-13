import { useState, useRef, useEffect, useMemo } from "react";
import { Search, ChevronDown, X, Loader2, Shield, Clock } from "lucide-react";

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

interface DeviceIdSearchProps {
  devices: DeviceInfo[];
  activations?: PremiumActivation[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  loading?: boolean;
  label?: string;
  excludeDeviceId?: string; // e.g. exclude "from" when picking "to"
}

export default function DeviceIdSearch({
  devices,
  activations = [],
  value,
  onChange,
  placeholder = "Rechercher un device_id...",
  loading = false,
  label,
  excludeDeviceId,
}: DeviceIdSearchProps) {
  const [query, setQuery] = useState(value || "");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Sync external value changes (e.g. programmatic clear)
  useEffect(() => {
    if (value && !query) setQuery(value);
    if (!value && query) {
      setQuery("");
    }
  }, [value]);

  // Filter devices based on search query
  const filtered = useMemo(() => {
    let list = devices;
    // Exclude a device (e.g. don't show "from" device in "to" picker)
    if (excludeDeviceId) {
      list = list.filter(d => d.device_id !== excludeDeviceId);
    }
    if (!query.trim()) return list;
    const q = query.toLowerCase().trim();
    return list.filter(d => d.device_id.toLowerCase().includes(q));
  }, [devices, query, excludeDeviceId]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Scroll selected item into view
  useEffect(() => {
    if (open && filtered.length > 0 && listRef.current) {
      const activeIdx = filtered.findIndex(d => d.device_id === value);
      if (activeIdx >= 0) {
        const items = listRef.current.children;
        if (items[activeIdx]) {
          items[activeIdx].scrollIntoView({ block: "nearest" });
        }
      }
    }
  }, [open, filtered, value]);

  const selectDevice = (deviceId: string) => {
    onChange(deviceId);
    setQuery(deviceId);
    setOpen(false);
  };

  const clearInput = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("");
    setQuery("");
    inputRef.current?.focus();
  };

  const handleInputChange = (val: string) => {
    setQuery(val);
    onChange(val); // Allow free text input too
    if (!open && val.length > 0) setOpen(true);
  };

  const highlightMatch = (deviceId: string, q: string) => {
    if (!q.trim()) return deviceId;
    const idx = deviceId.toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) return deviceId;
    return (
      <>
        {deviceId.slice(0, idx)}
        <span className="text-fire font-bold">{deviceId.slice(idx, idx + q.length)}</span>
        {deviceId.slice(idx + q.length)}
      </>
    );
  };

  // Check if a device has premium
  const hasPremium = (deviceId: string) => {
    return activations.some(a => a.device_id === deviceId);
  };

  const getPremiumExpiry = (deviceId: string) => {
    const act = activations.find(a => a.device_id === deviceId);
    if (!act) return null;
    return new Date(act.expires_at).toLocaleDateString("fr-FR");
  };

  // Check if premium is still active
  const isPremiumActive = (deviceId: string) => {
    const act = activations.find(a => a.device_id === deviceId);
    if (!act) return false;
    return new Date(act.expires_at) > new Date();
  };

  return (
    <div ref={containerRef} className="relative">
      {label && (
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-display block mb-1">
          {label}
        </label>
      )}
      <div
        className={`flex items-center gap-1 bg-muted border rounded-lg px-3 transition-colors ${
          open ? "border-fire ring-1 ring-fire/20" : "border-border"
        }`}
        onClick={() => inputRef.current?.focus()}
      >
        <Search size={14} className="text-muted-foreground flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => handleInputChange(e.target.value)}
          onFocus={() => { if (devices.length > 0 || query.trim()) setOpen(true); }}
          placeholder={placeholder}
          className="flex-1 bg-transparent py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/50 outline-none min-w-0"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {loading && <Loader2 size={14} className="animate-spin text-muted-foreground flex-shrink-0" />}
        {query && !loading && (
          <button onClick={clearInput} className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
            <X size={14} />
          </button>
        )}
        <ChevronDown
          size={14}
          className={`text-muted-foreground flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-popover border border-border rounded-lg shadow-lg max-h-72 overflow-hidden">
          {filtered.length === 0 && !loading && (
            <div className="px-3 py-2 text-xs text-muted-foreground text-center">
              {query.trim() ? "Aucun device_id trouvé" : "Aucun device enregistré"}
            </div>
          )}
          <div ref={listRef} className="overflow-y-auto max-h-64">
            {filtered.map(device => {
              const premium = hasPremium(device.device_id);
              const premiumActive = isPremiumActive(device.device_id);
              const premiumExpiry = getPremiumExpiry(device.device_id);

              return (
                <button
                  key={device.device_id}
                  type="button"
                  onClick={() => selectDevice(device.device_id)}
                  className={`w-full text-left px-3 py-2 transition-colors ${
                    device.device_id === value
                      ? "bg-fire/10"
                      : "hover:bg-muted"
                  }`}
                >
                  {/* Device ID */}
                  <div className="flex items-center gap-2">
                    <span className={`truncate text-xs font-mono ${
                      device.device_id === value
                        ? "text-fire font-semibold"
                        : "text-foreground"
                    }`}>
                      {highlightMatch(device.device_id, query)}
                    </span>
                    {device.device_id === value && (
                      <span className="text-[10px] text-fire bg-fire/10 px-1.5 py-0.5 rounded flex-shrink-0">
                        Sélectionné
                      </span>
                    )}
                  </div>

                  {/* Stats row */}
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-[10px] text-muted-foreground">
                      {device.total_predictions} préd.
                    </span>
                    {device.correct > 0 && (
                      <span className="text-[10px] text-success">✓ {device.correct}</span>
                    )}
                    {device.pending > 0 && (
                      <span className="text-[10px] text-gold">⏳ {device.pending}</span>
                    )}
                    {premium && (
                      <span className={`text-[10px] flex items-center gap-0.5 ${
                        premiumActive ? "text-fire" : "text-muted-foreground"
                      }`}>
                        <Shield size={10} />
                        {premiumActive ? "Premium actif" : "Premium exp."}
                        {premiumExpiry && (
                          <span className="flex items-center gap-0.5">
                            <Clock size={9} />
                            {premiumExpiry}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Free text hint */}
          {query.trim() && filtered.length === 0 && (
            <div className="px-3 py-2 border-t border-border">
              <button
                type="button"
                onClick={() => { onChange(query); setOpen(false); }}
                className="w-full text-left text-xs text-muted-foreground hover:text-fire transition-colors"
              >
                Utiliser "<span className="font-semibold text-foreground font-mono">{query}</span>" tel quel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
