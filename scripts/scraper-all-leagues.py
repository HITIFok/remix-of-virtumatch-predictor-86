#!/usr/bin/env python3
"""
Scraper Multi-Ligues bet261.mg
==============================
Scrape TOUTES les 8 ligues et envoie vers Supabase.

Installation Termux:
  pkg install python
  pip install requests

Usage:
  python scraper-all-leagues.py
"""

import requests
import json
import os
from datetime import datetime

# ============ CONFIGURATION ============
SUPABASE_URL = os.environ.get("SUPABASE_URL", "REDACTED_SUPABASE_URL")
FUNCTION_URL = f"{SUPABASE_URL}/functions/v1/push-odds"
PUSH_KEY = os.environ.get("PUSH_KEY", "")
ANON_KEY = os.environ.get("ANON_KEY", "")

if not PUSH_KEY or not ANON_KEY:
    print("ERREUR: Variables d'environnement PUSH_KEY et ANON_KEY requises.")
    print("  export PUSH_KEY='votre_cle'")
    print("  export ANON_KEY='votre_cle_anon'")
    sys.exit(1)

# Les 8 ligues
LEAGUES = [
    ("8035", "English League"),
    ("8060", "Coupe d'Afrique"),
    ("8056", "Champions League"),
    ("8036", "Italian League"),
    ("8037", "Spanish League"),
    ("8042", "French League"),
    ("8043", "German League"),
    ("8044", "Portuguese League"),
]

API_BASE = "https://hg-event-api-prod.sporty-tech.net/api/instantleagues"
HEADERS = {
    "Origin": "https://bet261.mg",
    "Referer": "https://bet261.mg/",
    "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36",
    "Accept": "application/json",
}


def api_get(path):
    """Fetch from API"""
    try:
        r = requests.get(f"{API_BASE}{path}", headers=HEADERS, timeout=30)
        return r.json() if r.status_code == 200 else None
    except:
        return None


def get_matches(lid, name):
    """Get upcoming matches"""
    data = api_get(f"/{lid}/matches")
    matches = []

    if data and "rounds" in data:
        for rd in data["rounds"]:
            rn = rd.get("roundNumber", 0)
            for m in rd.get("matches", []):
                oh, od, oa = 0.0, 0.0, 0.0
                active = False

                for bt in m.get("eventBetTypes", []):
                    if bt.get("name") == "1X2":
                        for it in bt.get("eventBetTypeItems", []):
                            if it.get("active") and it.get("bettingAllowed"):
                                active = True
                            sn = (it.get("shortName") or "").upper()
                            val = float(it.get("odds") or 0)
                            if sn == "1": oh = val
                            elif sn == "X": od = val
                            elif sn == "2": oa = val
                        break

                if active or oh > 0:
                    matches.append({
                        "id": m.get("id"),
                        "home": m.get("homeTeam", {}).get("name", ""),
                        "away": m.get("awayTeam", {}).get("name", ""),
                        "round": rn,
                        "league": name,
                        "status": "betting" if active else "upcoming",
                        "oddHome": oh,
                        "oddDraw": od,
                        "oddAway": oa,
                        "expectedStart": m.get("expectedStart", ""),
                    })
    return matches


def get_ranking(lid):
    """Get league ranking"""
    data = api_get(f"/{lid}/ranking")
    ranking = []

    if data and "teams" in data:
        for t in data["teams"]:
            ranking.append({
                "position": t.get("position", 0),
                "team": t.get("name", ""),
                "played": (t.get("won") or 0) + (t.get("draw") or 0) + (t.get("lost") or 0),
                "won": t.get("won") or 0,
                "drawn": t.get("draw") or 0,
                "lost": t.get("lost") or 0,
                "goalsFor": t.get("goalsFor") or 0,
                "goalsAgainst": t.get("goalsAgainst") or 0,
                "points": t.get("points") or 0,
            })
    return ranking


def get_results(lid, name):
    """Get past results"""
    data = api_get(f"/{lid}/results?skip=0&take=500")
    results = []

    if data and "rounds" in data:
        for rd in data["rounds"]:
            rn = rd.get("roundNumber", 0)
            for m in rd.get("matches", []):
                score = str(m.get("score") or "0:0").split(":")
                results.append({
                    "home": m.get("homeTeam", {}).get("name", ""),
                    "away": m.get("awayTeam", {}).get("name", ""),
                    "scoreHome": int(score[0]) if len(score) == 2 else 0,
                    "scoreAway": int(score[1]) if len(score) == 2 else 0,
                    "round": rn,
                    "league": name,
                })
    return results


def send_data(league, matches, ranking, results):
    """Send data to Supabase"""
    if not matches and not ranking and not results:
        return False, 0, 0, 0

    try:
        r = requests.post(
            FUNCTION_URL,
            json={
                "league": league,
                "matches": matches,
                "ranking": ranking,
                "results": results,
            },
            headers={
                "Content-Type": "application/json",
                "x-push-key": PUSH_KEY,
                "apikey": ANON_KEY,
                "Authorization": f"Bearer {ANON_KEY}",
            },
            timeout=60,
        )

        if r.status_code == 200:
            res = r.json()
            if res.get("success"):
                s = res.get("saved", {})
                return True, s.get("matches", 0), s.get("ranking", 0), s.get("results", 0)
        print(f"   Error: {r.status_code} - {r.text[:100]}")
        return False, 0, 0, 0
    except Exception as e:
        print(f"   Exception: {e}")
        return False, 0, 0, 0


def main():
    print()
    print("=" * 50)
    print("SCRAPER BET261.MG - TOUTES LES LIGUES")
    print("=" * 50)
    print(f"Heure: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}")
    print()

    total_m, total_r, total_res = 0, 0, 0

    for lid, name in LEAGUES:
        print(f"\n[{name}]")

        # Scrape
        m = get_matches(lid, name)
        r = get_ranking(lid)
        res = get_results(lid, name)

        print(f"  Scraped: {len(m)} matchs, {len(r)} equipes, {len(res)} resultats")

        # Send
        ok, sm, sr, sres = send_data(name, m, r, res)
        if ok:
            print(f"  Saved:   {sm} matchs, {sr} equipes, {sres} resultats")
            total_m += sm
            total_r += sr
            total_res += sres
        else:
            print("  FAILED!")

    print()
    print("=" * 50)
    print(f"TOTAL: {total_m} matchs, {total_r} equipes, {total_res} resultats")
    print("=" * 50)


if __name__ == "__main__":
    main()
