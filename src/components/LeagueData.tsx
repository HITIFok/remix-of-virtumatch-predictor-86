import { Shield, Trophy, Hash, Goal } from "lucide-react";
import type { RankingEntry, MatchResult as ScrapedResult } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

export function RankingTable({ ranking }: { ranking: RankingEntry[] }) {
  if (ranking.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[10px] font-display">
        <thead>
          <tr className="border-b border-border/50 text-muted-foreground">
            <th className="text-left py-2 px-1 w-6">#</th>
            <th className="text-left py-2 px-1">Équipe</th>
            <th className="text-center py-2 px-1 w-6">MJ</th>
            <th className="text-center py-2 px-1 w-6">V</th>
            <th className="text-center py-2 px-1 w-6">N</th>
            <th className="text-center py-2 px-1 w-6">D</th>
            <th className="text-center py-2 px-1 w-8">BP</th>
            <th className="text-center py-2 px-1 w-8">BC</th>
            <th className="text-center py-2 px-1 w-8">DB</th>
            <th className="text-center py-2 px-1 w-8 font-bold text-foreground">PTS</th>
          </tr>
        </thead>
        <tbody>
          {ranking.map((entry, idx) => (
            <tr
              key={`${entry.team}-${idx}`}
              className={`border-b border-border/20 ${
                idx < 2 ? "bg-success/5" : idx >= ranking.length - 2 ? "bg-destructive/5" : ""
              }`}
            >
              <td className="py-1.5 px-1 text-muted-foreground">{entry.position}</td>
              <td className="py-1.5 px-1 font-bold text-foreground truncate max-w-[100px]">
                {entry.team}
              </td>
              <td className="py-1.5 px-1 text-center text-muted-foreground">{entry.played}</td>
              <td className="py-1.5 px-1 text-center text-success">{entry.won}</td>
              <td className="py-1.5 px-1 text-center text-muted-foreground">{entry.drawn}</td>
              <td className="py-1.5 px-1 text-center text-destructive">{entry.lost}</td>
              <td className="py-1.5 px-1 text-center">{entry.goalsFor}</td>
              <td className="py-1.5 px-1 text-center">{entry.goalsAgainst}</td>
              <td className="py-1.5 px-1 text-center font-medium">
                {entry.goalDifference > 0 ? `+${entry.goalDifference}` : entry.goalDifference}
              </td>
              <td className="py-1.5 px-1 text-center font-black text-foreground">{entry.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ResultsList({ results }: { results: ScrapedResult[] }) {
  if (results.length === 0) return null;

  return (
    <div className="space-y-2">
      {results.map((r, idx) => (
        <div
          key={`${r.home}-${r.away}-${idx}`}
          className="flex items-center justify-between bg-gradient-card rounded-lg border border-border/50 px-3 py-2"
        >
          <span className="text-xs font-display font-bold text-foreground flex-1 truncate">
            {r.home}
          </span>
          <div className="flex items-center gap-1.5 mx-2">
            <span className={`text-sm font-display font-black ${
              r.scoreHome > r.scoreAway ? "text-success" : r.scoreHome < r.scoreAway ? "text-destructive" : "text-muted-foreground"
            }`}>
              {r.scoreHome}
            </span>
            <span className="text-[9px] text-muted-foreground">-</span>
            <span className={`text-sm font-display font-black ${
              r.scoreAway > r.scoreHome ? "text-success" : r.scoreAway < r.scoreHome ? "text-destructive" : "text-muted-foreground"
            }`}>
              {r.scoreAway}
            </span>
          </div>
          <span className="text-xs font-display font-bold text-foreground flex-1 truncate text-right">
            {r.away}
          </span>
        </div>
      ))}
    </div>
  );
}
