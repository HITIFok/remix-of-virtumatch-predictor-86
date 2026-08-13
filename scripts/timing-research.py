#!/usr/bin/env python3
"""
Investigation approfondie : Timing des donnees dans l'API sporty-tech
Objectif : Comprendre quand les resultats deviennent disponibles
          et comment recuperer les scores 1 minute avant le debut d'un match
"""

import json
import requests
import time
from datetime import datetime, timezone

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
    "8042": "French League",
    "8056": "Champions League",
}

def fetch(url, label=""):
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        if r.status_code == 200:
            return r.json()
        else:
            print(f"  [{label}] HTTP {r.status_code}")
            return None
    except Exception as e:
        print(f"  [{label}] ERROR: {e}")
        return None

def save_json(data, filename):
    with open(f"/home/z/my-project/download/{filename}", "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

print("=" * 70)
print("INVESTIGATION TIMING API SPORTY-TECH")
print(f"Horloge serveur: {datetime.now(timezone.utc).isoformat()}")
print("=" * 70)

# 1. ANALYSE DES DATES expectedStart
print("\n" + "-" * 70)
print("1. ANALYSE DES DATES expectedStart (toutes ligues)")
print("-" * 70)

for lid, name in LEAGUES.items():
    data = fetch(f"{BASE}/{lid}/matches", f"matches-{name}")
    if not data or "rounds" not in data:
        continue

    print(f"\n  {name} ({lid}):")
    print(f"  {len(data['rounds'])} rounds")

    for rd in data["rounds"]:
        rn = rd.get("roundNumber", 0)
        cat_id = rd.get("eventCategoryId", "N/A")
        start = rd.get("expectedStart", "")

        date_str = ""
        if start and start != "0001-01-01T00:00:00Z":
            try:
                dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
                now = datetime.now(timezone.utc)
                diff = dt - now
                if diff.total_seconds() > 0:
                    mins = int(diff.total_seconds() // 60)
                    secs = int(diff.total_seconds() % 60)
                    date_str = f" | dans {mins}m {secs}s"
                else:
                    date_str = f" | IL Y A {-diff.total_seconds():.0f}s"
            except:
                date_str = " | (parse error)"

        matches = rd.get("matches", [])
        has_betting = False
        for m in matches:
            for bt in m.get("eventBetTypes", []):
                for it in bt.get("eventBetTypeItems", []):
                    if it.get("active") and it.get("bettingAllowed"):
                        has_betting = True
                        break
                if has_betting:
                    break
            if has_betting:
                break

        bet_mark = "BETTING" if has_betting else ""
        print(f"    Round {rn} (cat={cat_id}): start={start}{date_str} [{bet_mark}]")

# 2. DETAILS MATCHS AVEC PARIS OUVERTS
print("\n" + "-" * 70)
print("2. DETAILS MATCHS AVEC PARIS OUVERTS")
print("-" * 70)

for lid, name in LEAGUES.items():
    data = fetch(f"{BASE}/{lid}/matches", f"detail-{name}")
    if not data or "rounds" not in data:
        continue

    for rd in data["rounds"]:
        has_betting = False
        for m in rd.get("matches", []):
            for bt in m.get("eventBetTypes", []):
                for it in bt.get("eventBetTypeItems", []):
                    if it.get("active") and it.get("bettingAllowed"):
                        has_betting = True
                        break
                if has_betting:
                    break
            if has_betting:
                break

        if has_betting:
            print(f"\n  {name} - Round {rd.get('roundNumber')} (BETTING OUVERT):")
            print(f"    expectedStart: {rd.get('expectedStart')}")
            print(f"    expectedEnd: {rd.get('expectedEnd')}")
            print(f"    eventCategoryId: {rd.get('eventCategoryId')}")
            print(f"    Nombre de matchs: {len(rd.get('matches', []))}")

            for m in rd.get("matches", [])[:2]:
                print(f"\n    Match: {m.get('homeTeam', {}).get('name')} vs {m.get('awayTeam', {}).get('name')}")
                print(f"      id: {m.get('id')}")
                print(f"      entryPointId: {m.get('entryPointId')}")
                print(f"      expectedStart: {m.get('expectedStart')}")
                print(f"      round: {m.get('round')}")
                for k, v in m.items():
                    if k not in ("eventBetTypes", "homeTeam", "awayTeam"):
                        print(f"      {k}: {v}")

            break
    else:
        continue
    break

# 3. PLOUT : RESULTATS DISPONIBLES POUR CHAQUE ROUND
print("\n" + "-" * 70)
print("3. PLOUT : RESULTATS DISPONIBLES POUR CHAQUE ROUND")
print("-" * 70)

for lid, name in LEAGUES.items():
    data = fetch(f"{BASE}/{lid}/matches", f"playout-scan-{name}")
    if not data or "rounds" not in data:
        continue

    print(f"\n  {name} ({lid}):")

    for rd in data["rounds"]:
        rn = rd.get("roundNumber", 0)
        cat_id = rd.get("eventCategoryId", None)

        if not cat_id:
            print(f"    Round {rn}: PAS de eventCategoryId (skipping)")
            continue

        pdata = fetch(f"{BASE}/round/{rn}/playout?parentEventCategoryId={lid}&eventCategoryId={cat_id}", f"plout-{name}-r{rn}")
        if pdata and "matches" in pdata:
            matches_count = len(pdata["matches"])
            if matches_count > 0:
                print(f"    Round {rn}: {matches_count} resultats dans playout")
                for pm in pdata["matches"][:3]:
                    goals = pm.get("goals", [])
                    last = goals[-1] if goals else {}
                    print(f"      Match {pm.get('id')}: {last.get('homeScore', '?')}-{last.get('awayScore', '?')} (min={last.get('minute', '?')}, {len(goals)} buts)")
                    if goals:
                        print(f"        Buts: {json.dumps(goals, ensure_ascii=False)}")
            else:
                print(f"    Round {rn}: 0 resultats (vide)")
        else:
            print(f"    Round {rn}: erreur ou vide")

        time.sleep(0.3)

# 4. RESULTS : STRUCTURE TEMPORELLE DETAILLEE
print("\n" + "-" * 70)
print("4. RESULTS : STRUCTURE TEMPORELLE DETAILLEE")
print("-" * 70)

data = fetch(f"{BASE}/8035/results?skip=0&take=5", "results-timing")
if data and "rounds" in data:
    for rd in data["rounds"][:3]:
        print(f"\n  Round {rd.get('roundNumber')}: {len(rd.get('matches', []))} resultats")
        for m in rd.get("matches", [])[:2]:
            print(f"\n    {m.get('homeTeam', {}).get('name')} vs {m.get('awayTeam', {}).get('name')}")
            print(f"      score: {m.get('score')}")
            print(f"      halfTimeScore: {m.get('halfTimeScore')}")
            print(f"      expectedStart: {m.get('expectedStart')}")
            print(f"      id: {m.get('id')}")

            goals = m.get("goals", [])
            print(f"      goals ({len(goals)}):")
            for g in goals:
                print(f"        min={g.get('minute')} home={g.get('homeScore')} away={g.get('awayScore')} team={g.get('team')}")

            all_keys = set(m.keys()) - {"homeTeam", "awayTeam", "goals", "eventBetTypes"}
            print(f"      autres cles: {all_keys}")

# 5. COMPARER IDs : matches actifs vs results vs playout
print("\n" + "-" * 70)
print("5. COMPARER IDs : matches actifs vs results vs playout")
print("-" * 70)

data_matches = fetch(f"{BASE}/8035/matches", "compare-matches")
data_results = fetch(f"{BASE}/8035/results?skip=0&take=5", "compare-results")

if data_matches and data_results:
    active_ids = set()
    all_match_ids = set()
    for rd in data_matches.get("rounds", []):
        for m in rd.get("matches", []):
            all_match_ids.add(m.get("id"))
            for bt in m.get("eventBetTypes", []):
                for it in bt.get("eventBetTypeItems", []):
                    if it.get("active") and it.get("bettingAllowed"):
                        active_ids.add(m.get("id"))

    result_ids = set()
    for rd in data_results.get("rounds", []):
        for m in rd.get("matches", []):
            result_ids.add(m.get("id"))

    print(f"\n  Matches dans l'endpoint matches: {len(all_match_ids)}")
    print(f"  Matches avec betting ouvert: {len(active_ids)}")
    print(f"  Matches dans l'endpoint results: {len(result_ids)}")

    overlap = all_match_ids & result_ids
    if overlap:
        print(f"\n  OVERLAP: {len(overlap)} matchs presents dans matches ET results")
    else:
        print(f"\n  Aucun overlap - les resultats ne se melangent pas aux matchs actifs")

    betting_in_results = active_ids & result_ids
    if betting_in_results:
        print(f"\n  CRITIQUE: {len(betting_in_results)} matchs AVEC PARIS OUVERTS ont des resultats!")
    else:
        print(f"\n  Aucun match avec paris ouverts n'a de resultat")

# 6. PLOUT DU ROUND ACTUEL (BETTING)
print("\n" + "-" * 70)
print("6. PLOUT DU ROUND ACTUEL (BETTING OUVERT)")
print("-" * 70)

for lid, name in LEAGUES.items():
    data = fetch(f"{BASE}/{lid}/matches", f"betting-round-{name}")
    if not data or "rounds" not in data:
        continue

    betting_round = None
    betting_cat_id = None
    betting_match_ids = set()

    for rd in data["rounds"]:
        for m in rd.get("matches", []):
            for bt in m.get("eventBetTypes", []):
                for it in bt.get("eventBetTypeItems", []):
                    if it.get("active") and it.get("bettingAllowed"):
                        betting_match_ids.add(m.get("id"))
                        betting_round = rd.get("roundNumber")
                        betting_cat_id = rd.get("eventCategoryId")
                        break
                if betting_round:
                    break
            if betting_round:
                break
        if betting_round:
            break

    if not betting_round:
        print(f"\n  {name}: aucun round avec paris ouverts")
        continue

    print(f"\n  {name} - Round {betting_round} (BETTING, cat={betting_cat_id}):")
    print(f"    {len(betting_match_ids)} matchs avec paris ouverts")

    pdata = fetch(f"{BASE}/round/{betting_round}/playout?parentEventCategoryId={lid}&eventCategoryId={betting_cat_id}", f"betting-plout-{name}")
    if pdata and "matches" in pdata:
        playout_ids = set(m.get("id") for m in pdata["matches"])
        overlap = betting_match_ids & playout_ids

        print(f"    Playout: {len(playout_ids)} matchs")
        print(f"    Overlap (betting intersect playout): {len(overlap)} matchs")

        if overlap:
            print(f"\n    MATCHS AVEC PARIS OUVERTS ET SCORES DANS PLOUT:")
            for mid in overlap:
                for pm in pdata["matches"]:
                    if pm.get("id") == mid:
                        goals = pm.get("goals", [])
                        last = goals[-1] if goals else {}
                        match_name = "?"
                        for rd2 in data["rounds"]:
                            for m2 in rd2.get("matches", []):
                                if m2.get("id") == mid:
                                    match_name = f"{m2.get('homeTeam', {}).get('name')} vs {m2.get('awayTeam', {}).get('name')}"
                                    break
                        print(f"      {match_name}: {last.get('homeScore', '?')}-{last.get('awayScore', '?')} (min={last.get('minute', '?')})")
                        print(f"        Buts: {json.dumps(goals, ensure_ascii=False)}")
                        break
        else:
            print(f"    Aucun score disponible pour les matchs avec paris ouverts")
    else:
        print(f"    Playout: vide ou erreur")

    time.sleep(0.5)

# 7. expectedStart : NIVEAU MATCH vs NIVEAU ROUND
print("\n" + "-" * 70)
print("7. expectedStart : NIVEAU MATCH vs NIVEAU ROUND")
print("-" * 70)

for lid, name in [("8035", "English League")]:
    data = fetch(f"{BASE}/{lid}/matches", f"timing-{name}")
    if not data or "rounds" not in data:
        continue

    for rd in data["rounds"][:3]:
        rn = rd.get("roundNumber", 0)
        round_start = rd.get("expectedStart", "")
        print(f"\n  Round {rn}: expectedStart={round_start}")

        for m in rd.get("matches", [])[:3]:
            match_start = m.get("expectedStart", "")
            match_name = f"{m.get('homeTeam', {}).get('name')} vs {m.get('awayTeam', {}).get('name')}"
            same = "MÊME" if match_start == round_start else "DIFFÉRENT"
            print(f"    {match_name}: {match_start} [{same}]")

# 8. STRUCTURE COMPLETE D'UN ROUND BETTING
print("\n" + "-" * 70)
print("8. STRUCTURE COMPLETE D'UN ROUND BETTING")
print("-" * 70)

for lid, name in [("8035", "English League")]:
    data = fetch(f"{BASE}/{lid}/matches", f"round-struct-{name}")
    if not data or "rounds" not in data:
        continue

    for rd in data["rounds"]:
        has_betting = False
        for m in rd.get("matches", []):
            for bt in m.get("eventBetTypes", []):
                for it in bt.get("eventBetTypeItems", []):
                    if it.get("active") and it.get("bettingAllowed"):
                        has_betting = True
                        break
                if has_betting:
                    break
            if has_betting:
                break

        if has_betting:
            print(f"\n  Round {rd.get('roundNumber')} (BETTING) - Toutes les clés:")
            for k, v in rd.items():
                if k != "matches":
                    val_str = str(v)[:120]
                    print(f"    {k}: {val_str}")
            break

# 9. SAUVEGARDE DONNEES BRUTES
print("\n" + "-" * 70)
print("9. SAUVEGARDE DES DONNÉES BRUTES")
print("-" * 70)

for lid, name in [("8035", "english")]:
    data = fetch(f"{BASE}/{lid}/matches", f"save-{name}")
    if data:
        save_json(data, f"timing_{name}_matches.json")
        print(f"  Saved timing_{name}_matches.json")

    rdata = fetch(f"{BASE}/{lid}/results?skip=0&take=10", f"save-{name}-results")
    if rdata:
        save_json(rdata, f"timing_{name}_results.json")
        print(f"  Saved timing_{name}_results.json")

    if data and "rounds" in data:
        for rd in data["rounds"]:
            cat_id = rd.get("eventCategoryId")
            rn = rd.get("roundNumber")
            has_bet = any(
                any(it.get("active") and it.get("bettingAllowed")
                    for bt in m.get("eventBetTypes", [])
                    for it in bt.get("eventBetTypeItems", []))
                for m in rd.get("matches", [])
            )
            if has_bet and cat_id:
                pdata = fetch(f"{BASE}/round/{rn}/playout?parentEventCategoryId={lid}&eventCategoryId={cat_id}", f"save-{name}-plout")
                if pdata:
                    save_json(pdata, f"timing_{name}_playout_r{rn}.json")
                    print(f"  Saved timing_{name}_playout_r{rn}.json")
                break

print("\n" + "=" * 70)
print("INVESTIGATION TIMING TERMINEE")
print("=" * 70)
