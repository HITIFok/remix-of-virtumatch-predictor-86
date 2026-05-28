#!/usr/bin/env python3
"""
Scraper bet261.mg - Instant League
==================================
API: hg-event-api-prod.sporty-tech.net
Structure des cotes: eventBetTypes[0].eventBetTypeItems[{shortName:"1", odds:1.71}, ...]

Note: expectedStart est toujours "0001-01-01T00:00:00Z" (valeur par défaut)
Les matchs à venir sont identifiés par active=true et bettingAllowed=true

Installation:
  pip install requests

Usage:
  python scraper-api.py
"""

import json
import time
from datetime import datetime

# ============ CONFIGURATION ============
import os

DATABASE_URL = os.environ.get("DATABASE_URL", "")
PUSH_ENDPOINT = f"{DATABASE_URL}/functions/v1/push-odds"
PUSH_KEY = os.environ.get("PUSH_KEY", "")
ANON_KEY = os.environ.get("ANON_KEY", "")

if not PUSH_KEY:
    print("ERREUR: PUSH_KEY non définie. Exportez-la :")
    print("  export PUSH_KEY='votre_cle'")
    sys.exit(1)
if not ANON_KEY:
    print("ERREUR: ANON_KEY non définie. Exportez-la :")
    print("  export ANON_KEY='votre_cle_anon'")
    sys.exit(1)

LEAGUE_ID = "8035"
API_MATCHES = f"https://hg-event-api-prod.sporty-tech.net/api/instantleagues/{LEAGUE_ID}/matches"
API_RANKING = f"https://hg-event-api-prod.sporty-tech.net/api/instantleagues/{LEAGUE_ID}/ranking"
API_RESULTS = f"https://hg-event-api-prod.sporty-tech.net/api/instantleagues/{LEAGUE_ID}/results?skip=0&take=100"

REFRESH_INTERVAL = 120

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
            print(f"     ✅ OK")
            return resp.json()
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
    
    # ========== MATCHS À VENIR ==========
    # Note: L'API retourne expectedStart = "0001-01-01T00:00:00Z" pour tous les matchs
    # Un match est à venir si les cotes sont actives (active=true, bettingAllowed=true)
    data = fetch_api(API_MATCHES, "Matchs")
    if data and "rounds" in data:
        for round_data in data["rounds"]:
            round_num = round_data.get("roundNumber", 0)
            
            for m in round_data.get("matches", []):
                try:
                    # Extraire les cotes et vérifier si le match est actif
                    event_bet_types = m.get("eventBetTypes", [])
                    has_active_odds = False
                    odd_home, odd_draw, odd_away = 0.0, 0.0, 0.0
                    
                    for bet_type in event_bet_types:
                        if bet_type.get("name") == "1X2":
                            items = bet_type.get("eventBetTypeItems", [])
                            for item in items:
                                # Vérifier si les paris sont ouverts
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
                    
                    # Ignorer les matchs sans cotes actives
                    if not has_active_odds and odd_home == 0:
                        continue
                    
                    match = {
                        "id": m.get("id"),
                        "home": m.get("homeTeam", {}).get("name", ""),
                        "away": m.get("awayTeam", {}).get("name", ""),
                        "name": m.get("name", ""),
                        "round": round_num,
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
    
    # Afficher les cotes du premier match pour debug
    if matches:
        m = matches[0]
        print(f"\n     🎯 {m['home']} vs {m['away']}")
        print(f"        Cotes: {m['oddHome']} / {m['oddDraw']} / {m['oddAway']}")
    
    print(f"\n📊 Résumé:")
    print(f"   Matchs à venir: {len(matches)}")
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
                "Authorization": f"Bearer {ANON_KEY}",
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
