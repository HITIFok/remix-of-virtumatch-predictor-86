#!/usr/bin/env python3
"""
Scraper bet261.mg - Version API
================================
Utilise les APIs JSON de sporty-tech.net

Installation:
  pip install requests

Usage:
  python scraper-api.py
"""

import json
import time
from datetime import datetime

# ============ CONFIGURATION ============
DATABASE_URL = "https://gxmmeemzkixinsxglfaq.redacted.example.com"
PUSH_ENDPOINT = f"{DATABASE_URL}/functions/v1/push-odds"
PUSH_KEY = "REDACTED"
ANON_KEY = "sb_publishable_b4JnhE55g-HiGl1Q4J5nFw_OKxturOX"

LEAGUE_ID = "8035"
API_BASE = f"https://hg-event-api-prod.sporty-tech.net/api/instantleagues/{LEAGUE_ID}"
API_MATCHES = f"{API_BASE}/matches"
API_RANKING = f"{API_BASE}/ranking"
API_RESULTS = f"{API_BASE}/results?skip=0&take=10"

REFRESH_INTERVAL = 120

# Headers requis
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
        print(f"  📡 {name}...")
        resp = requests.get(url, headers=HEADERS, timeout=30)
        
        if resp.status_code == 200:
            data = resp.json()
            print(f"     ✅ OK")
            return data
        else:
            print(f"     ❌ HTTP {resp.status_code}")
            return None
    except Exception as e:
        print(f"     ❌ Erreur: {e}")
        return None


def scrape():
    """Scrape toutes les données"""
    matches = []
    ranking = []
    results = []
    
    # ========== MATCHS ==========
    data = fetch_api(API_MATCHES, "Matchs")
    if data and "rounds" in data:
        for round_data in data["rounds"]:
            for m in round_data.get("matches", []):
                try:
                    # Extraire les cotes
                    odd_home, odd_draw, odd_away = 0.0, 0.0, 0.0
                    for bet_type in m.get("eventBetTypes", []):
                        if bet_type.get("name") == "1X2":
                            items = bet_type.get("eventBetTypeItems", [])
                            for item in items:
                                item_name = item.get("name", "").lower()
                                odd_val = item.get("odd", 0)
                                if item_name in ["1", "home"]:
                                    odd_home = odd_val
                                elif item_name in ["x", "draw"]:
                                    odd_draw = odd_val
                                elif item_name in ["2", "away"]:
                                    odd_away = odd_val
                    
                    match = {
                        "id": m.get("id"),
                        "home": m.get("homeTeam", {}).get("name", ""),
                        "away": m.get("awayTeam", {}).get("name", ""),
                        "name": m.get("name", ""),
                        "round": m.get("round", ""),
                        "league": "Instant League",
                        "status": "upcoming",
                        "oddHome": odd_home,
                        "oddDraw": odd_draw,
                        "oddAway": odd_away,
                        "expectedStart": m.get("expectedStart", ""),
                    }
                    matches.append(match)
                except Exception as e:
                    print(f"     ⚠️ Erreur match: {e}")
    
    # ========== CLASSEMENT ==========
    data = fetch_api(API_RANKING, "Classement")
    if data:
        items = data if isinstance(data, list) else data.get("ranking", data.get("data", []))
        for i, r in enumerate(items):
            try:
                team = {
                    "position": r.get("position", i + 1),
                    "team": r.get("team", r.get("name", r.get("teamName", ""))),
                    "played": r.get("played", r.get("gamesPlayed", 0)),
                    "won": r.get("won", 0),
                    "drawn": r.get("drawn", r.get("draw", 0)),
                    "lost": r.get("lost", 0),
                    "goalsFor": r.get("goalsFor", r.get("gf", 0)),
                    "goalsAgainst": r.get("goalsAgainst", r.get("ga", 0)),
                    "points": r.get("points", 0),
                }
                ranking.append(team)
            except Exception as e:
                pass
    
    # ========== RÉSULTATS ==========
    data = fetch_api(API_RESULTS, "Résultats")
    if data:
        items = data if isinstance(data, list) else data.get("results", data.get("data", []))
        for r in items:
            try:
                result = {
                    "home": r.get("homeTeam", {}).get("name", r.get("homeTeam", "")),
                    "away": r.get("awayTeam", {}).get("name", r.get("awayTeam", "")),
                    "scoreHome": r.get("homeScore", r.get("scoreHome", 0)),
                    "scoreAway": r.get("awayScore", r.get("scoreAway", 0)),
                    "league": "Instant League",
                }
                results.append(result)
            except:
                pass
    
    print(f"\n📊 Résumé:")
    print(f"   Matchs: {len(matches)}")
    print(f"   Classement: {len(ranking)}")
    print(f"   Résultats: {len(results)}")
    
    return {"matches": matches, "ranking": ranking, "results": results}


def push_data(data):
    """Envoie les données vers Supabase"""
    import requests
    
    print(f"\n📤 Envoi vers Supabase...")
    
    try:
        resp = requests.post(
            PUSH_ENDPOINT,
            json=data,
            headers={
                "Content-Type": "application/json",
                "x-push-key": PUSH_KEY,
                "apikey": ANON_KEY,
            },
            timeout=30,
        )
        
        result = resp.json()
        if result.get("success"):
            saved = result.get("saved", {})
            print(f"✅ Succès! {datetime.now().strftime('%H:%M:%S')}")
            print(f"   Matchs: {saved.get('matches', 0)}")
            print(f"   Classement: {saved.get('ranking', 0)}")
            print(f"   Résultats: {saved.get('results', 0)}")
        else:
            print(f"❌ Erreur: {result.get('error')}")
        
        return result
        
    except Exception as e:
        print(f"❌ Erreur d'envoi: {e}")
        return None


def main():
    print()
    print("=" * 50)
    print("🏟️  SCRAPER bet261.mg - Instant League")
    print("=" * 50)
    print(f"📍 Supabase: {DATABASE_URL}")
    print(f"⏱️  Intervalle: {REFRESH_INTERVAL}s")
    print()
    
    while True:
        try:
            print(f"\n{'─' * 50}")
            print(f"📅 {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}")
            print('─' * 50)
            
            data = scrape()
            
            total = len(data.get("matches", [])) + len(data.get("ranking", [])) + len(data.get("results", []))
            if total > 0:
                push_data(data)
            else:
                print("⚠️ Aucune donnée récupérée")
            
        except KeyboardInterrupt:
            print("\n\n👋 Arrêt du scraper")
            break
        except Exception as e:
            print(f"❌ Erreur: {e}")
        
        print(f"\n⏳ Prochain scrape dans {REFRESH_INTERVAL}s... (Ctrl+C pour arrêter)")
        time.sleep(REFRESH_INTERVAL)


if __name__ == "__main__":
    main()
