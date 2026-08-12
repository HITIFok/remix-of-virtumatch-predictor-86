#!/usr/bin/env python3
"""
Investigation complète de l'API sporty-tech.net
Teste tous les endpoints et paramètres exploitables
"""

import json
import requests
import time

BASE = "https://hg-event-api-prod.sporty-tech.net/api/instantleagues"

HEADERS = {
    "Origin": "",
    "Referer": "",
    "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "fr-FR,fr;q=0.9",
    "App-Version": "",
}

LEAGUES = {
    "8035": "English League",
    "8060": "Coupe d'Afrique",
    "8056": "Champions League",
    "8036": "Italian League",
    "8037": "Spanish League",
    "8042": "French League",
    "8043": "German League",
    "8044": "Portuguese League",
    "8065": "Coupe du monde",
}

def fetch(url, label=""):
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        print(f"  [{label}] HTTP {r.status_code} | {len(r.text)} chars")
        if r.status_code == 200:
            try:
                data = r.json()
                keys = list(data.keys()) if isinstance(data, dict) else "N/A"
                print(f"    Type: {type(data).__name__}, Keys: {keys}")
                return data
            except:
                print(f"    (not JSON)")
                return None
        else:
            print(f"    Body: {r.text[:200]}")
            return None
    except Exception as e:
        print(f"  [{label}] ERROR: {e}")
        return None

def deep_inspect(data, path="root", depth=0, max_depth=3):
    if depth >= max_depth:
        return
    indent = "  " * (depth + 1)
    if isinstance(data, dict):
        for k, v in data.items():
            if isinstance(v, dict):
                print(f"{indent}{k}: dict({len(v)} keys) {list(v.keys())[:5]}")
                deep_inspect(v, f"{path}.{k}", depth+1, max_depth)
            elif isinstance(v, list):
                print(f"{indent}{k}: list({len(v)} items)")
                if len(v) > 0:
                    deep_inspect(v[0], f"{path}.{k}[0]", depth+1, max_depth)
            else:
                val_str = str(v)[:80]
                print(f"{indent}{k}: {type(v).__name__} = {val_str}")
    elif isinstance(data, list) and len(data) > 0:
        deep_inspect(data[0], f"{path}[0]", depth, max_depth)

print("=" * 70)
print("INVESTIGATION API SPORTY-TECH")
print("=" * 70)

# 1. ENDPOINTS DE BASE
print("\n" + "-" * 70)
print("1. ENDPOINTS DE BASE (English League 8035)")
print("-" * 70)

endpoints = [
    ("/8035", "matches (base)"),
    ("/8035/matches", "matches explicite"),
    ("/8035/ranking", "ranking"),
    ("/8035/results?skip=0&take=10", "results (10)"),
    ("/8035/results?skip=0&take=200", "results (200)"),
    ("/8035/live", "live"),
    ("/8035/highlights", "highlights"),
    ("/8035/statistics", "statistics"),
    ("/8035/standings", "standings"),
    ("/8035/schedule", "schedule"),
    ("/8035/teams", "teams"),
    ("/8035/odds", "odds"),
    ("/8035/topscorers", "topscorers"),
    ("/8035/inplay", "inplay"),
]

for path, label in endpoints:
    print(f"\nGET {BASE}{path}")
    fetch(f"{BASE}{path}", label)
    time.sleep(0.3)

# 2. PLAYOUT
print("\n" + "-" * 70)
print("2. PLAYOUT - ROUNDS (English League 8035)")
print("-" * 70)

playout_endpoints = [
    ("/round/1/playout?parentEventCategoryId=8035", "round 1"),
    ("/round/5/playout?parentEventCategoryId=8035", "round 5"),
    ("/round/10/playout?parentEventCategoryId=8035", "round 10"),
    ("/round/15/playout?parentEventCategoryId=8035", "round 15"),
    ("/round/20/playout?parentEventCategoryId=8035", "round 20"),
    ("/round/30/playout?parentEventCategoryId=8035", "round 30"),
    ("/round/50/playout?parentEventCategoryId=8035", "round 50"),
    ("/round/10/playout?parentEventCategoryId=8035&eventCategoryId=160408", "round 10 + eventCategoryId"),
]

for path, label in playout_endpoints:
    print(f"\nGET {BASE}{path}")
    fetch(f"{BASE}{path}", label)
    time.sleep(0.3)

# 3. STRUCTURE DETAILLEE MATCHS
print("\n" + "-" * 70)
print("3. STRUCTURE DETAILLEE - MATCHS")
print("-" * 70)

data = fetch(f"{BASE}/8035/matches", "matches-detail")
if data and "rounds" in data:
    for rd in data.get("rounds", [])[:2]:
        print(f"\n  Round {rd.get('roundNumber')}: {len(rd.get('matches', []))} matches")
        for m in rd.get("matches", [])[:1]:
            print(f"\n  Détails complet du match:")
            deep_inspect(m, "match", 0, 4)

    # Bet types disponibles
    print("\n  Types de paris (eventBetTypes) par match:")
    all_bet_types = set()
    for rd in data.get("rounds", []):
        for m in rd.get("matches", []):
            for bt in m.get("eventBetTypes", []):
                all_bet_types.add(bt.get("name", "?"))
    print(f"    Types trouvés: {all_bet_types}")

    # Détails d'un bet type
    print("\n  Détails eventBetTypes du 1er match:")
    if data.get("rounds") and data["rounds"][0].get("matches"):
        m = data["rounds"][0]["matches"][0]
        for bt in m.get("eventBetTypes", []):
            name = bt.get("name", "?")
            items = bt.get("eventBetTypeItems", [])
            active_items = [i for i in items if i.get("active")]
            print(f"\n    Type: {name} ({len(items)} items, {len(active_items)} actifs)")
            for it in items[:5]:
                print(f"      {it.get('shortName')}: odds={it.get('odds')} active={it.get('active')} betting={it.get('bettingAllowed')}")

# 4. STRUCTURE RANKING
print("\n" + "-" * 70)
print("4. STRUCTURE RANKING")
print("-" * 70)

data = fetch(f"{BASE}/8035/ranking", "ranking-detail")
if data and "teams" in data:
    print(f"\n  {len(data['teams'])} équipes")
    if data["teams"]:
        print("\n  Premier équipe (détail complet):")
        deep_inspect(data["teams"][0], "team", 0, 3)

# 5. STRUCTURE RESULTS
print("\n" + "-" * 70)
print("5. STRUCTURE RESULTS")
print("-" * 70)

data = fetch(f"{BASE}/8035/results?skip=0&take=10", "results-detail")
if data and "rounds" in data:
    for rd in data.get("rounds", [])[:1]:
        print(f"\n  Round {rd.get('roundNumber')}: {len(rd.get('matches', []))} résultats")
        if rd.get("matches"):
            print("\n  Premier résultat (détail):")
            deep_inspect(rd["matches"][0], "result", 0, 4)

# 6. PARAMETRES EXPLOITABLES
print("\n" + "-" * 70)
print("6. PARAMETRES EXPLOITABLES - TESTS")
print("-" * 70)

param_tests = [
    ("/8035/matches?market=1X2", "market filter"),
    ("/8035/matches?market=OVER_UNDER", "market OU"),
    ("/8035/matches?market=BOTH_TEAMS_TO_SCORE", "market BTTS"),
    ("/8035/matches?lang=en", "lang en"),
    ("/8035/matches?lang=fr", "lang fr"),
    ("/8035/matches?expanded=true", "expanded"),
    ("/8035/matches?include=all", "include all"),
    ("/8035/matches?with=odds", "with odds"),
]

for path, label in param_tests:
    print(f"\nGET {BASE}{path}")
    fetch(f"{BASE}{path}", label)
    time.sleep(0.3)

# 7. TEST TOUTES LES LIGUES
print("\n" + "-" * 70)
print("7. TEST RAPIDE TOUTES LES LIGUES")
print("-" * 70)

for lid, name in LEAGUES.items():
    data = fetch(f"{BASE}/{lid}/matches", f"{name} ({lid})")
    if data and "rounds" in data:
        total = sum(len(rd.get("matches", [])) for rd in data["rounds"])
        rounds = len(data["rounds"])
        print(f"    -> {rounds} rounds, {total} matchs")
    time.sleep(0.3)

# 8. PLAYOUT - TROUVER ROUND ACTIFS
print("\n" + "-" * 70)
print("8. PLAYOUT - SCANNER ROUNDS ACTIFS (betting ouvert)")
print("-" * 70)

for lid, name in [("8035", "English League"), ("8042", "French League")]:
    print(f"\n  {name} ({lid}):")
    data = fetch(f"{BASE}/{lid}/matches", f"scan-{name}")
    if data and "rounds" in data:
        for rd in data["rounds"]:
            rn = rd.get("roundNumber", 0)
            match_count = len(rd.get("matches", []))
            has_betting = any(
                any(it.get("active") and it.get("bettingAllowed") for bt in m.get("eventBetTypes", []) for it in bt.get("eventBetTypeItems", []))
                for m in rd.get("matches", [])
            )
            print(f"    Round {rn}: {match_count} matchs {'  FIRE BETTING OPEN' if has_betting else ''}")

# 9. TEST AUTRES BASES URL
print("\n" + "-" * 70)
print("9. TEST AUTRES BASES URL")
print("-" * 70)

alt_bases = [
    "https://hg-event-api-prod.sporty-tech.net/api/instantleagues",
    "https://hg-event-api-prod.sporty-tech.net/api",
    "https://hg-event-api.sporty-tech.net/api/instantleagues",
    "https://event-api.sporty-tech.net/api/instantleagues",
]

for base in alt_bases:
    print(f"\n  Base: {base}")
    try:
        r = requests.get(f"{base}/8035/matches", headers=HEADERS, timeout=10)
        print(f"    HTTP {r.status_code} | {len(r.text)} chars")
    except Exception as e:
        print(f"    ERROR: {e}")

# 10. STRUCTURE PLAYOUT DETAILLEE
print("\n" + "-" * 70)
print("10. STRUCTURE PLAYOUT DETAILLEE (round 10)")
print("-" * 70)

data = fetch(f"{BASE}/round/10/playout?parentEventCategoryId=8035", "playout-detail")
if data and "matches" in data:
    print(f"\n  {len(data['matches'])} matchs dans le playout")
    if data["matches"]:
        print("\n  Premier match playout (détail):")
        deep_inspect(data["matches"][0], "playout-match", 0, 4)

print("\n" + "=" * 70)
print("INVESTIGATION TERMINEE")
print("=" * 70)
