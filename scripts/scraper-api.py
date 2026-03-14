#!/usr/bin/env python3
"""
Scraper bet261.mg - Version API (JSON)
======================================
Utilise les APIs JSON de sporty-tech.net
À exécuter dans Termux (Android) ou sur PC

Installation:
  pip install requests

Usage:
  python scraper-api.py
"""

import json
import time
import sys
from datetime import datetime

# ============ CONFIGURATION ============
SUPABASE_URL = "REDACTED_SUPABASE_URL"
PUSH_ENDPOINT = f"{SUPABASE_URL}/functions/v1/push-odds"
PUSH_KEY = "REDACTED_PUSH_KEY"
ANON_KEY = "REDACTED_ANON_KEY"

# APIs Instant League
LEAGUE_ID = "8035"
API_BASE = "https://hg-event-api-prod.sporty-tech.net/api/instantleagues"
API_MATCHES = f"{API_BASE}/{LEAGUE_ID}/matches"
API_RANKING = f"{API_BASE}/{LEAGUE_ID}/ranking"
API_RESULTS = f"{API_BASE}/{LEAGUE_ID}/results?skip=0&take=10"

REFRESH_INTERVAL = 120  # 2 minutes


def fetch_api(url, name):
    """Récupère les données depuis l'API"""
    import requests
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36",
        "Accept": "application/json",
        "Origin": "https://bet261.mg",
        "Referer": "https://bet261.mg/",
    }
    
    try:
        print(f"  📡 {name}...")
        resp = requests.get(url, headers=headers, timeout=30)
        
        if resp.status_code == 200:
            data = resp.json()
            print(f"     ✅ OK ({len(json.dumps(data))} bytes)")
            return data
        else:
            print(f"     ❌ Erreur HTTP {resp.status_code}")
            return None
    except Exception as e:
        print(f"     ❌ Erreur: {e}")
        return None


def scrape():
    """Scrape toutes les données"""
    print(f"\n🌐 Récupération des données...")
    
    # Matchs
    matches_data = fetch_api(API_MATCHES, "Matchs")
    matches = []
    if matches_data:
        # La structure peut varier, on essaie de parser
        if isinstance(matches_data, list):
            for m in matches_data:
                try:
                    match = {
                        "home": m.get("homeTeam", m.get("home", "")),
                        "away": m.get("awayTeam", m.get("away", "")),
                        "league": "Instant League",
                        "status": m.get("status", "upcoming"),
                    }
                    # Cotes
                    if "odds" in m:
                        odds = m["odds"]
                        match["oddHome"] = odds.get("home", odds.get("1", 0))
                        match["oddDraw"] = odds.get("draw", odds.get("X", 0))
                        match["oddAway"] = odds.get("away", odds.get("2", 0))
                    elif "homeOdds" in m:
                        match["oddHome"] = m.get("homeOdds", 0)
                        match["oddDraw"] = m.get("drawOdds", 0)
                        match["oddAway"] = m.get("awayOdds", 0)
                    matches.append(match)
                except Exception as e:
                    pass
        elif isinstance(matches_data, dict):
            # Peut-être dans un champ "data" ou "matches"
            items = matches_data.get("data", matches_data.get("matches", matches_data.get("items", [])))
            for m in items:
                try:
                    match = {
                        "home": m.get("homeTeam", m.get("homeTeamName", m.get("home", ""))),
                        "away": m.get("awayTeam", m.get("awayTeamName", m.get("away", "")),
                        "league": "Instant League",
                        "status": m.get("status", "upcoming"),
                    }
                    if "homeOdds" in m:
                        match["oddHome"] = float(m.get("homeOdds", 0))
                        match["oddDraw"] = float(m.get("drawOdds", 0))
                        match["oddAway"] = float(m.get("awayOdds", 0))
                    matches.append(match)
                except:
                    pass
    
    # Classement
    ranking_data = fetch_api(API_RANKING, "Classement")
    ranking = []
    if ranking_data:
        items = ranking_data if isinstance(ranking_data, list) else ranking_data.get("data", ranking_data.get("ranking", []))
        for i, r in enumerate(items):
            try:
                team = {
                    "position": r.get("position", r.get("rank", i + 1)),
                    "team": r.get("team", r.get("teamName", r.get("name", ""))),
                    "played": r.get("played", r.get("gamesPlayed", 0)),
                    "won": r.get("won", r.get("wins", 0)),
                    "drawn": r.get("drawn", r.get("draws", 0)),
                    "lost": r.get("lost", r.get("losses", 0)),
                    "goalsFor": r.get("goalsFor", r.get("gf", 0)),
                    "goalsAgainst": r.get("goalsAgainst", r.get("ga", 0)),
                    "points": r.get("points", 0),
                }
                ranking.append(team)
            except:
                pass
    
    # Résultats
    results_data = fetch_api(API_RESULTS, "Résultats")
    results = []
    if results_data:
        items = results_data if isinstance(results_data, list) else results_data.get("data", results_data.get("results", []))
        for r in items:
            try:
                result = {
                    "home": r.get("homeTeam", r.get("home", "")),
                    "away": r.get("awayTeam", r.get("away", "")),
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
    print("🏟️  SCRAPER bet261.mg - Version API")
    print("=" * 50)
    print(f"📍 Supabase: {SUPABASE_URL}")
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
