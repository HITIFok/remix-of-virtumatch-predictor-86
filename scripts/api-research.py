#!/usr/bin/env python3
"""Investigation API sporty-tech avec vrais headers"""

import json
import requests
import time

BASE = "https://hg-event-api-prod.sporty-tech.net/api/instantleagues"

HEADERS = {
    "Origin": "https://bet261.mg",
    "Referer": "https://bet261.mg/",
    "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "fr-FR,fr;q=0.9",
    "App-Version": "33335",
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
        elif r.status_code == 403:
            print(f"    GEO-BLOCKED")
            return None
        else:
            print(f"    Body: {r.text[:300]}")
            return None
    except Exception as e:
        print(f"  [{label}] ERROR: {e}")
        return None

def deep_inspect(data, depth=0, max_depth=3):
    if depth >= max_depth or not isinstance(data, dict):
        return
    indent = "  " * (depth + 1)
    for k, v in data.items():
        if isinstance(v, dict):
            print(f"{indent}{k}: dict({len(v)} keys) {list(v.keys())[:8]}")
            deep_inspect(v, depth+1, max_depth)
        elif isinstance(v, list):
            print(f"{indent}{k}: list({len(v)} items)")
            if len(v) > 0 and isinstance(v[0], dict):
                print(f"{indent}  [0] keys: {list(v[0].keys())[:8]}")
                if depth < max_depth - 1:
                    deep_inspect(v[0], depth+1, max_depth)
        else:
            val_str = str(v)[:100]
            print(f"{indent}{k}: {type(v).__name__} = {val_str}")

def save_json(data, filename):
    with open(f"/home/z/my-project/download/{filename}", "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"    Saved to download/{filename}")

print("=" * 70)
print("INVESTIGATION API SPORTY-TECH (avec vrais headers)")
print("=" * 70)

# ─── 1. ENDPOINTS DE BASE ─────────────────────────────────────────────
print("\n" + "-" * 70)
print("1. ENDPOINTS DE BASE (English League 8035)")
print("-" * 70)

endpoints = [
    ("/8035/matches", "matches"),
    ("/8035/ranking", "ranking"),
    ("/8035/results?skip=0&take=10", "results"),
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
    data = fetch(f"{BASE}{path}", label)
    if data:
        save_json(data, f"1_{label}.json")
    time.sleep(0.5)

# ─── 2. PLAYOUT ROUNDS ────────────────────────────────────────────────
print("\n" + "-" * 70)
print("2. PLAYOUT - ROUNDS (English League 8035)")
print("-" * 70)

for rn in [1, 5, 8, 10, 12, 15, 20, 30, 50]:
    print(f"\nGET round/{rn}/playout?parentEventCategoryId=8035")
    data = fetch(f"{BASE}/round/{rn}/playout?parentEventCategoryId=8035", f"playout-r{rn}")
    if data:
        matches = data.get("matches", [])
        print(f"    {len(matches)} matchs dans le playout")
        save_json(data, f"2_playout_r{rn}.json")
    time.sleep(0.3)

# avec eventCategoryId
print(f"\nGET round/10/playout?parentEventCategoryId=8035&eventCategoryId=160408")
data = fetch(f"{BASE}/round/10/playout?parentEventCategoryId=8035&eventCategoryId=160408", "playout+eventCat")
if data:
    save_json(data, "2_playout_r10_eventcat.json")
time.sleep(0.3)

# ─── 3. STRUCTURE MATCH DETAILLEE ────────────────────────────────────
print("\n" + "-" * 70)
print("3. STRUCTURE DETAILLEE - MATCHS")
print("-" * 70)

data = fetch(f"{BASE}/8035/matches", "struct-matches")
if data and "rounds" in data:
    total_rounds = len(data["rounds"])
    total_matches = sum(len(rd.get("matches", [])) for rd in data["rounds"])
    print(f"\n  Total: {total_rounds} rounds, {total_matches} matchs")

    # Tous les bet types
    all_bet_types = {}
    for rd in data["rounds"]:
        for m in rd.get("matches", []):
            for bt in m.get("eventBetTypes", []):
                name = bt.get("name", "?")
                items = bt.get("eventBetTypeItems", [])
                if name not in all_bet_types:
                    all_bet_types[name] = {"count": 0, "items_per_type": len(items), "sample_items": []}
                all_bet_types[name]["count"] += 1
                if len(all_bet_types[name]["sample_items"]) < 3:
                    sample = []
                    for it in items[:3]:
                        sample.append({
                            "shortName": it.get("shortName"),
                            "odds": it.get("odds"),
                            "active": it.get("active"),
                            "bettingAllowed": it.get("bettingAllowed"),
                        })
                    all_bet_types[name]["sample_items"].append(sample)

    print(f"\n  Types de paris trouvés: {len(all_bet_types)}")
    for name, info in sorted(all_bet_types.items()):
        print(f"\n    '{name}' — présent dans {info['count']} matchs, ~{info['items_per_type']} items")
        if info["sample_items"]:
            sample = info["sample_items"][0]
            for s in sample:
                active_mark = "ACTIVE" if s["active"] else "inactive"
                betting_mark = "BETTING" if s["bettingAllowed"] else "no-bet"
                print(f"      {s['shortName']}: {s['odds']} ({active_mark}, {betting_mark})")

    # Détail premier match complet
    for rd in data["rounds"]:
        if rd.get("matches"):
            m = rd["matches"][0]
            print(f"\n  Premier match (round {rd.get('roundNumber')}):")
            deep_inspect(m, 0, 5)
            break

    # Scanner rounds avec betting ouvert
    print(f"\n  Rounds avec paris ouverts:")
    for rd in data["rounds"]:
        rn = rd.get("roundNumber", 0)
        has_betting = False
        betting_count = 0
        for m in rd.get("matches", []):
            for bt in m.get("eventBetTypes", []):
                for it in bt.get("eventBetTypeItems", []):
                    if it.get("active") and it.get("bettingAllowed"):
                        has_betting = True
                        betting_count += 1
        if has_betting:
            print(f"    Round {rn}: {len(rd.get('matches', []))} matchs, {betting_count} bets actifs")

# ─── 4. STRUCTURE RANKING ─────────────────────────────────────────────
print("\n" + "-" * 70)
print("4. STRUCTURE RANKING")
print("-" * 70)

data = fetch(f"{BASE}/8035/ranking", "struct-ranking")
if data:
    if "teams" in data:
        print(f"\n  {len(data['teams'])} équipes")
        if data["teams"]:
            print("\n  Détail équipe #1:")
            deep_inspect(data["teams"][0], 0, 4)
    else:
        print("\n  Structure inattendue:")
        deep_inspect(data, 0, 3)

# ─── 5. STRUCTURE RESULTS ─────────────────────────────────────────────
print("\n" + "-" * 70)
print("5. STRUCTURE RESULTS")
print("-" * 70)

data = fetch(f"{BASE}/8035/results?skip=0&take=10", "struct-results")
if data and "rounds" in data:
    for rd in data["rounds"][:1]:
        print(f"\n  Round {rd.get('roundNumber')}: {len(rd.get('matches', []))} résultats")
        if rd.get("matches"):
            print("\n  Détail premier résultat:")
            deep_inspect(rd["matches"][0], 0, 4)

# ─── 6. TOUTES LES LIGUES ─────────────────────────────────────────────
print("\n" + "-" * 70)
print("6. TEST TOUTES LES LIGUES")
print("-" * 70)

for lid, name in LEAGUES.items():
    data = fetch(f"{BASE}/{lid}/matches", f"{name} ({lid})")
    if data and "rounds" in data:
        total = sum(len(rd.get("matches", [])) for rd in data["rounds"])
        rounds = len(data["rounds"])
        # Trouver round avec betting
        betting_round = None
        for rd in data["rounds"]:
            for m in rd.get("matches", []):
                for bt in m.get("eventBetTypes", []):
                    for it in bt.get("eventBetTypeItems", []):
                        if it.get("active") and it.get("bettingAllowed"):
                            betting_round = rd.get("roundNumber")
                            break
                    if betting_round:
                        break
                if betting_round:
                    break
            if betting_round:
                break
        bet_str = f"betting round={betting_round}" if betting_round else "no betting"
        print(f"    -> {rounds} rounds, {total} matchs [{bet_str}]")
    time.sleep(0.5)

# ─── 7. PARAMETRES ADDITIONNELS ───────────────────────────────────────
print("\n" + "-" * 70)
print("7. PARAMETRES ADDITIONNELS")
print("-" * 70)

param_tests = [
    ("/8035/matches?market=1X2", "market=1X2"),
    ("/8035/matches?market=OVER_UNDER", "market=OU"),
    ("/8035/matches?market=BOTH_TEAMS_TO_SCORE", "market=BTTS"),
    ("/8035/matches?expanded=true", "expanded=true"),
    ("/8035/matches?include=odds", "include=odds"),
    ("/8035/matches?with=events", "with=events"),
    ("/8035/matches?lang=en", "lang=en"),
    ("/8035/matches?lang=fr", "lang=fr"),
]

for path, label in param_tests:
    print(f"\nGET {BASE}{path}")
    fetch(f"{BASE}{path}", label)
    time.sleep(0.3)

# ─── 8. STRUCTURE PLAYOUT DETAILLEE ────────────────────────────────────
print("\n" + "-" * 70)
print("8. STRUCTURE PLAYOUT DETAILLEE")
print("-" * 70)

# Trouver un round avec betting
data = fetch(f"{BASE}/8035/matches", "find-betting-round")
betting_round = None
if data and "rounds" in data:
    for rd in data["rounds"]:
        for m in rd.get("matches", []):
            for bt in m.get("eventBetTypes", []):
                for it in bt.get("eventBetTypeItems", []):
                    if it.get("active") and it.get("bettingAllowed"):
                        betting_round = rd.get("roundNumber")
                        break
                if betting_round:
                    break
            if betting_round:
                break
        if betting_round:
            break

if betting_round:
    print(f"\n  Betting round trouvé: {betting_round}")
    print(f"\n  Playout round {betting_round}:")
    pdata = fetch(f"{BASE}/round/{betting_round}/playout?parentEventCategoryId=8035", f"playout-active-r{betting_round}")
    if pdata and "matches" in pdata:
        print(f"  {len(pdata['matches'])} matchs")
        for pm in pdata["matches"][:2]:
            print("\n  Détail match playout:")
            deep_inspect(pm, 0, 4)
        save_json(pdata, f"8_playout_active_r{betting_round}.json")

# ─── 9. AUTRES ENDPOINTS POSSIBLES ────────────────────────────────────
print("\n" + "-" * 70)
print("9. AUTRES ENDPOINTS POSSIBLES")
print("-" * 70)

alt_endpoints = [
    ("/8035/events", "events"),
    ("/8035/fixtures", "fixtures"),
    ("/8035/scores", "scores"),
    ("/8035/lineups", "lineups"),
    ("/8035/h2h", "h2h"),
    ("/8035/matches/odds", "matches/odds"),
    ("/8035/round/current", "round/current"),
    ("/round/current/playout?parentEventCategoryId=8035", "playout current"),
    ("/8035/matches/upcoming", "matches/upcoming"),
    ("/8035/matches/finished", "matches/finished"),
]

for path, label in alt_endpoints:
    print(f"\nGET {BASE}{path}")
    fetch(f"{BASE}{path}", label)
    time.sleep(0.3)

# ─── 10. MATCH DETAIL ENDPOINT ────────────────────────────────────────
print("\n" + "-" * 70)
print("10. MATCH DETAIL (si match ID dispo)")
print("-" * 70)

data = fetch(f"{BASE}/8035/matches", "get-match-id")
if data and "rounds" in data:
    for rd in data["rounds"]:
        for m in rd.get("matches", []):
            mid = m.get("id")
            if mid:
                print(f"\n  Match ID: {mid}")
                # Tester différents formats d'endpoint détail
                detail_endpoints = [
                    (f"/match/{mid}", f"match/{mid}"),
                    (f"/8035/match/{mid}", f"8035/match/{mid}"),
                    (f"/event/{mid}", f"event/{mid}"),
                    (f"/8035/event/{mid}", f"8035/event/{mid}"),
                    (f"/matches/{mid}", f"matches/{mid}"),
                ]
                for path, label in detail_endpoints:
                    print(f"\n  GET {BASE}{path}")
                    fetch(f"{BASE}{path}", label)
                    time.sleep(0.3)
                break
        else:
            continue
        break

print("\n" + "=" * 70)
print("INVESTIGATION TERMINEE")
print("Fichiers JSON sauvegardés dans /home/z/my-project/download/")
print("=" * 70)
