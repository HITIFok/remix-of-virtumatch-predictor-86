#!/usr/bin/env python3
"""
Scraper bet261.mg - Instant League
==================================
API: hg-event-api-prod.sporty-tech.net
Structure des cotes: eventBetTypes[0].eventBetTypeItems[{shortName:"1", odds:1.71}, ...]

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
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd4bW1lZW16a2l4aW5zeGdsZmFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MDUzNTUsImV4cCI6MjA4ODk4MTM1NX0.5MEMH8RS6HX3CJfAJATilNlz_hVrBeOdSjeur-wmr9E"

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


def get_match_status(m):
    """Détermine le statut du match"""
    # Vérifier les champs de statut de l'API
    if m.get("isFinished") or m.get("status") == "finished":
        return "finished"
    if m.get("isLive") or m.get("status") == "live":
        return "live"
    
    # Vérifier via expectedStart
    expected = m.get("expectedStart")
    if expected:
        try:
            from datetime import datetime, timezone
            start_time = datetime.fromisoformat(expected.replace("Z", "+00:00"))
            now = datetime.now(timezone.utc)
            
            diff = (start_time - now).total_seconds()
            
            if diff < -7200:  # Commencé il y a plus de 2h = terminé
                return "finished"
            elif diff < 0:  # Commencé mais pas encore terminé
                return "live"
        except:
            pass
    
    return "upcoming"


def scrape():
    """Scrape toutes les données"""
    matches = []
    ranking = []
    results = []
    
    now = datetime.now()
    
    # ========== MATCHS (uniquement à venir) ==========
    data = fetch_api(API_MATCHES, "Matchs")
    if data and "rounds" in data:
        for round_data in data["rounds"]:
            for m in round_data.get("matches", []):
                try:
                    # Déterminer le statut du match
                    status = get_match_status(m)
                    
                    # Ne garder que les matchs à venir ou en cours
                    if status == "finished":
                        continue
                    
                    # Extraire les cotes depuis eventBetTypes
                    odd_home, odd_draw, odd_away = 0.0, 0.0, 0.0
                    
                    event_bet_types = m.get("eventBetTypes", [])
                    for bet_type in event_bet_types:
                        if bet_type.get("name") == "1X2":
                            items = bet_type.get("eventBetTypeItems", [])
                            for item in items:
                                short_name = (item.get("shortName") or "").upper()
                                odd_val = item.get("odds", 0)
                                
                                if short_name == "1":
                                    odd_home = odd_val
                                elif short_name == "X":
                                    odd_draw = odd_val
                                elif short_name == "2":
                                    odd_away = odd_val
                            break
                    
                    # Extraire le score si live
                    score_home = m.get("homeScore") or m.get("score", "").split(":")[0] if ":" in m.get("score", "") else None
                    score_away = m.get("awayScore") or m.get("score", "").split(":")[1] if ":" in m.get("score", "") else None
                    
                    match = {
                        "id": m.get("id"),
                        "home": m.get("homeTeam", {}).get("name", ""),
                        "away": m.get("awayTeam", {}).get("name", ""),
                        "name": m.get("name", ""),
                        "round": m.get("round", ""),
                        "league": "Instant League",
                        "status": status,
                        "oddHome": odd_home,
                        "oddDraw": odd_draw,
                        "oddAway": odd_away,
                        "expectedStart": m.get("expectedStart", ""),
                        "scoreHome": int(score_home) if score_home and status == "live" else None,
                        "scoreAway": int(score_away) if score_away and status == "live" else None,
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
