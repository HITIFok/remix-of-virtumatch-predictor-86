import { useState, useRef, useEffect, useMemo } from "react";
import { Search, ChevronDown, X, Loader2 } from "lucide-react";

interface TeamSearchProps {
  teams: string[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  loading?: boolean;
  label?: string;
}

export default function TeamSearch({
  teams,
  value,
  onChange,
  placeholder = "Rechercher une équipe...",
  loading = false,
  label,
}: TeamSearchProps) {
  const [query, setQuery] = useState(value || "");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Sync external value changes
  useEffect(() => {
    if (value && !query) setQuery(value);
  }, [value]);

  // Filter teams based on search query
  const filtered = useMemo(() => {
    if (!query.trim()) return teams;
    const q = query.toLowerCase().trim();
    return teams.filter(t => t.toLowerCase().includes(q));
  }, [teams, query]);

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
      const activeIdx = filtered.findIndex(t => t === value);
      if (activeIdx >= 0) {
        const items = listRef.current.children;
        if (items[activeIdx]) {
          items[activeIdx].scrollIntoView({ block: "nearest" });
        }
      }
    }
  }, [open, filtered, value]);

  const selectTeam = (team: string) => {
    onChange(team);
    setQuery(team);
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

  const highlightMatch = (team: string, q: string) => {
    if (!q.trim()) return team;
    const idx = team.toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) return team;
    return (
      <>
        {team.slice(0, idx)}
        <span className="text-fire font-bold">{team.slice(idx, idx + q.length)}</span>
        {team.slice(idx + q.length)}
      </>
    );
  };

  return (
    <div ref={containerRef} className="relative">
      {label && (
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
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
          onFocus={() => { if (teams.length > 0) setOpen(true); }}
          placeholder={placeholder}
          className="flex-1 bg-transparent py-2 text-sm font-medium text-foreground placeholder:text-muted-foreground/50 outline-none min-w-0"
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
        <div className="absolute z-50 mt-1 w-full bg-popover border border-border rounded-lg shadow-lg max-h-48 overflow-hidden">
          {filtered.length === 0 && !loading && (
            <div className="px-3 py-2 text-xs text-muted-foreground text-center">
              {query.trim() ? "Aucune équipe trouvée" : "Chargement des équipes..."}
            </div>
          )}
          <div ref={listRef} className="overflow-y-auto max-h-44">
            {filtered.map(team => (
              <button
                key={team}
                type="button"
                onClick={() => selectTeam(team)}
                className={`w-full text-left px-3 py-2 text-sm transition-colors flex items-center gap-2 ${
                  team === value
                    ? "bg-fire/10 text-fire font-semibold"
                    : "text-foreground hover:bg-muted"
                }`}
              >
                <span className="truncate">{highlightMatch(team, query)}</span>
                {team === value && (
                  <span className="ml-auto text-[10px] text-fire bg-fire/10 px-1.5 py-0.5 rounded flex-shrink-0">
                    Sélectionné
                  </span>
                )}
              </button>
            ))}
          </div>
          {/* Free text hint */}
          {query.trim() && filtered.length === 0 && (
            <div className="px-3 py-2 border-t border-border">
              <button
                type="button"
                onClick={() => { onChange(query); setOpen(false); }}
                className="w-full text-left text-xs text-muted-foreground hover:text-fire transition-colors"
              >
                Utiliser "<span className="font-semibold text-foreground">{query}</span>" tel quel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
