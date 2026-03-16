#!/usr/bin/env python3
"""
Scraper bet261.mg - Version Live (30s interval)
===============================================
Capture TOUS les matchs, même sans cotes actives

Installation:
  pip install requests

Usage:
  python scraper-live.py
"""

import json
import time
from datetime import datetime

# ============ CONFIGURATION ============
SUPABASE_URL = "REDACTED_SUPABASE_URL"
SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd4bW1lZW16a2l4aW5zeGdsZmFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MDUzNTUsImV4cCI6MjA4ODk4MTM1NX0.5MEMH8RS6HX3CJfAJATilNlz_hVrBeOdSjeur-wmr9E"

LEAGUE_ID = "8035"
API_MATCHES = f"https://hg-event-api-prod.sporty-tech.net/api/instantleagues/{LEAGUE_ID}/matches"
API_RANKING = f"https://hg-event-api-prod.sporty-tech.net/api/instantleagues/{LEAGUE_ID}/ranking"
API_RESULTS = f"https://hg-event-api-prod.sporty-tech.net/api/instantleagues/{LEAGUE_ID}/results?skip=0&take=100"

# Rafraîchissement plus fréquent (30 secondes)
REFRESH_INTERVAL = 30

HEADERS = {
    "Origin": "https://bet261.mg",
    "Referer": "https://bet261.mg/",
    "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/137.0.0.0 Mobile Safari/537.36",
    "Accept": "application/json",
}


def fetch_api(url, name):
    """Récupère les données depuis l'API"""
    import requests
    try:
        resp = requests.get(url, headers=HEADERS, timeout=30)
        if resp.status_code == 200:
            return resp.json()
        else:
            print(f"  ❌ {name}: HTTP {resp.status_code}")
            return None
    except Exception as e:
        print(f"  ❌ {name}: {e}")
        return None


def scrape():
    """Scrape toutes les données"""
    matches = []
    ranking = []
    results = []
    
    # ========== MATCHS (TOUS, même sans cotes actives) ==========
    data = fetch_api(API_MATCHES, "Matchs")
    if data and "rounds" in data:
        for round_data in data["rounds"]:
            round_num = round_data.get("roundNumber", 0)
            
            for m in round_data.get("matches", []):
                try:
                    event_bet_types = m.get("eventBetTypes", [])
                    has_active_odds = False
                    odd_home, odd_draw, odd_away = 0.0, 0.0, 0.0
                    
                    for bet_type in event_bet_types:
                        if bet_type.get("name") == "1X2":
                            items = bet_type.get("eventBetTypeItems", [])
                            for item in items:
                                if item.get("active") and item.get("bettingAllowed"):
                                    has_active_odds = True
                                
                                short_name = (item.get("shortName") or "").upper()
                                odd_val = item.get("odds", 0) or 0
                                
                                if short_name == "1":
                                    odd_home = odd_val
                                elif short_name == "X":
                                    odd_draw = odd_val
                                elif short_name == "2":
                                    odd_away = odd_val
                            break
                    
                    # IMPORTANT: On garde TOUS les matchs, même sans cotes
                    # Un match sans cotes actives est "à venir"
                    # Un match avec cotes actives est "en cours de paris"
                    
                    status = "upcoming"
                    if has_active_odds:
                        status = "betting"  # Paris ouverts
                    
                    match = {
                        "id": m.get("id"),
                        "home": m.get("homeTeam", {}).get("name", ""),
                        "away": m.get("awayTeam", {}).get("name", ""),
                        "round": round_num,
                        "league": "Instant League",
                        "status": status,
                        "oddHome": odd_home,
                        "oddDraw": odd_draw,
                        "oddAway": odd_away,
                        "expectedStart": m.get("expectedStart", ""),
                        "hasActiveOdds": has_active_odds,
                    }
                    matches.append(match)
                    
                except Exception as e:
                    print(f"  ⚠️ Erreur match: {e}")
    
    # ========== CLASSEMENT ==========
    data = fetch_api(API_RANKING, "Classement")
    if data and "teams" in data:
        for r in data["teams"]:
            try:
                team = {
                    "position": r.get("position", 0),
                    "team": r.get("name", ""),
                    "played": (r.get("won", 0) or 0) + (r.get("lost", 0) or 0) + (r.get("draw", 0) or 0),
                    "won": r.get("won", 0) or 0,
                    "drawn": r.get("draw", 0) or 0,
                    "lost": r.get("lost", 0) or 0,
                    "goalsFor": r.get("goalsFor", 0) or 0,
                    "goalsAgainst": r.get("goalsAgainst", 0) or 0,
                    "points": r.get("points", 0) or 0,
                }
                ranking.append(team)
            except:
                pass
    
    # ========== RÉSULTATS ==========
    data = fetch_api(API_RESULTS, "Résultats")
    if data and "rounds" in data:
        for round_data in data["rounds"]:
            for m in round_data.get("matches", []):
                try:
                    score = m.get("score", "0:0")
                    parts = score.split(":")
                    score_home = int(parts[0]) if len(parts) == 2 else 0
                    score_away = int(parts[1]) if len(parts) == 2 else 0
                    
                    result = {
                        "home": m.get("homeTeam", {}).get("name", ""),
                        "away": m.get("awayTeam", {}).get("name", ""),
                        "scoreHome": score_home,
                        "scoreAway": score_away,
                        "round": round_data.get("roundNumber", 0),
                        "league": "Instant League",
                    }
                    results.append(result)
                except:
                    pass
    
    return {"matches": matches, "ranking": ranking, "results": results}


def save_to_supabase(data):
    """Envoie les données vers Supabase directement"""
    import requests
    
    now = datetime.now().isoformat()
    saved = {"matches": 0, "ranking": 0, "results": 0}
    
    # Sauvegarder chaque type de données
    if data.get("matches"):
        resp = requests.post(
            f"{SUPABASE_URL}/rest/v1/scraped_data?onConflict=data_type,league",
            json={
                "data_type": "matches",
                "league": "Instant League",
                "payload": data["matches"],
                "scraped_at": now,
            },
            headers={
                "Content-Type": "application/json",
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
                "Prefer": "resolution=merge-duplicates",
            },
            timeout=30,
        )
        if resp.status_code in [200, 201]:
            saved["matches"] = len(data["matches"])
    
    if data.get("ranking"):
        resp = requests.post(
            f"{SUPABASE_URL}/rest/v1/scraped_data?onConflict=data_type,league",
            json={
                "data_type": "ranking",
                "league": "Instant League",
                "payload": data["ranking"],
                "scraped_at": now,
            },
            headers={
                "Content-Type": "application/json",
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
                "Prefer": "resolution=merge-duplicates",
            },
            timeout=30,
        )
        if resp.status_code in [200, 201]:
            saved["ranking"] = len(data["ranking"])
    
    if data.get("results"):
        resp = requests.post(
            f"{SUPABASE_URL}/rest/v1/scraped_data?onConflict=data_type,league",
            json={
                "data_type": "results",
                "league": "Instant League",
                "payload": data["results"],
                "scraped_at": now,
            },
            headers={
                "Content-Type": "application/json",
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
                "Prefer": "resolution=merge-duplicates",
            },
            timeout=30,
        )
        if resp.status_code in [200, 201]:
            saved["results"] = len(data["results"])
    
    return saved


def main():
    print()
    print("=" * 50)
    print("🏟️  SCRAPER LIVE - Instant League (30s)")
    print("=" * 50)
    print(f"📍 Supabase: {SUPABASE_URL}")
    print(f"⏱️  Intervalle: {REFRESH_INTERVAL}s")
    print()
    
    while True:
        try:
            now = datetime.now().strftime('%H:%M:%S')
            print(f"\n[{now}] 🔄 Scraping...")
            
            data = scrape()
            
            matches = data.get("matches", [])
            betting = len([m for m in matches if m.get("hasActiveOdds")])
            upcoming = len(matches) - betting
            
            print(f"   📊 {len(matches)} matchs ({betting} paris ouverts, {upcoming} à venir)")
            print(f"   🏆 {len(data.get('ranking', []))} équipes")
            print(f"   📋 {len(data.get('results', []))} résultats")
            
            if matches or data.get("ranking") or data.get("results"):
                saved = save_to_supabase(data)
                print(f"   ✅ Sauvegardé: {saved}")
            else:
                print("   ⚠️ Aucune donnée")
            
        except KeyboardInterrupt:
            print("\n\n👋 Arrêt du scraper")
            break
        except Exception as e:
            print(f"   ❌ Erreur: {e}")
        
        print(f"   ⏳ Prochain dans {REFRESH_INTERVAL}s...")
        time.sleep(REFRESH_INTERVAL)


if __name__ == "__main__":
    main()
