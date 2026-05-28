#!/usr/bin/env python3
"""
Scraper - Version Termux (Android)
===================================
A exécuter dans Termux avec connexion 4G

Variables d'environnement requises:
  export DATABASE_URL='https://your-project.redacted.example.com'
  export PUSH_KEY='your-push-key'
  export ANON_KEY='your-anon-key'
  export SCRAPER_TARGET_URL='your-target-url'
"""

import json
import time
import re
import sys
import os
from datetime import datetime

# ============ CONFIGURATION ============
# Toutes les clés doivent être définies via des variables d'environnement
# Ne JAMAIS hardcoder de secrets dans le code source
DATABASE_URL = os.environ.get("DATABASE_URL", "")
PUSH_ENDPOINT = f"{DATABASE_URL}/functions/v1/push-odds"
PUSH_KEY = os.environ.get("PUSH_KEY", "")
ANON_KEY = os.environ.get("ANON_KEY", "")
TARGET_URL = os.environ.get("SCRAPER_TARGET_URL", "")
REFRESH_INTERVAL = 120

if not DATABASE_URL:
    print("ERREUR: DATABASE_URL non definie. Exportez-la :")
    print("  export DATABASE_URL='https://votre-projet.redacted.example.com'")
    sys.exit(1)
if not PUSH_KEY:
    print("ERREUR: PUSH_KEY non definie. Exportez-la :")
    print("  export PUSH_KEY='votre_cle'")
    sys.exit(1)
if not ANON_KEY:
    print("ERREUR: ANON_KEY non definie. Exportez-la :")
    print("  export ANON_KEY='votre_cle_anon'")
    sys.exit(1)
if not TARGET_URL:
    print("ERREUR: SCRAPER_TARGET_URL non definie. Exportez-la :")
    print("  export SCRAPER_TARGET_URL='your-target-url'")
    sys.exit(1)

# ============ SCRAPING ============

def scrape():
    """Scrape avec requests"""
    import requests
    from bs4 import BeautifulSoup
    import urllib3
    
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate",
        "Connection": "keep-alive",
    }
    
    print(f"🌐 Connexion à {TARGET_URL}...")
    
    try:
        resp = requests.get(TARGET_URL, headers=headers, timeout=30, verify=False)
        print(f"📊 Status: {resp.status_code}")
        print(f"📄 Taille: {len(resp.text)} caractères")
        
        # Sauvegarder pour debug
        with open("debug.html", "w", encoding="utf-8") as f:
            f.write(resp.text)
        print("💾 HTML sauvegardé dans debug.html")
        
        if "ACCESS FORBIDDEN" in resp.text:
            print("❌ ACCÈS INTERDIT - IP non autorisée")
            return None
            
        if resp.status_code != 200:
            print(f"❌ Erreur HTTP: {resp.status_code}")
            return None
        
        return parse_html(resp.text)
        
    except Exception as e:
        print(f"❌ Erreur: {e}")
        return None


def parse_html(html):
    """Extrait les données du HTML"""
    from bs4 import BeautifulSoup
    
    soup = BeautifulSoup(html, "html.parser")
    matches = []
    results = []
    ranking = []
    
    print("🔍 Analyse du HTML...")
    
    # Chercher les éléments
    instant_league = soup.find_all(class_=re.compile("instant", re.I))
    print(f"   Éléments 'instant': {len(instant_league)}")
    
    # Matchs
    match_selectors = [
        "hg-instant-league-matches .match",
        ".match-row",
        ".event-row", 
        "[class*='match']"
    ]
    
    match_elements = []
    for sel in match_selectors:
        match_elements = soup.select(sel)
        if match_elements:
            print(f"   Matchs trouvés: {len(match_elements)}")
            break
    
    for el in match_elements:
        try:
            home_el = el.select_one(".home, .team-home, [class*='home']")
            away_el = el.select_one(".away, .team-away, [class*='away']")
            odds_els = el.select(".odd, [class*='odd'], [class*='coef']")
            
            if home_el and away_el:
                match = {
                    "home": home_el.get_text(strip=True),
                    "away": away_el.get_text(strip=True),
                    "league": "Instant League",
                    "status": "upcoming",
                }
                if len(odds_els) >= 3:
                    match["oddHome"] = parse_float(odds_els[0].get_text(strip=True))
                    match["oddDraw"] = parse_float(odds_els[1].get_text(strip=True))
                    match["oddAway"] = parse_float(odds_els[2].get_text(strip=True))
                matches.append(match)
        except:
            pass
    
    # Classement
    ranking_table = soup.select_one("hg-instant-league-ranking table, .ranking table, table")
    if ranking_table:
        for i, row in enumerate(ranking_table.select("tr")[1:]):
            cells = row.select("td")
            if len(cells) >= 8:
                try:
                    ranking.append({
                        "position": i + 1,
                        "team": cells[1].get_text(strip=True),
                        "played": parse_int(cells[2].get_text(strip=True)),
                        "won": parse_int(cells[3].get_text(strip=True)),
                        "drawn": parse_int(cells[4].get_text(strip=True)),
                        "lost": parse_int(cells[5].get_text(strip=True)),
                        "goalsFor": parse_int(cells[6].get_text(strip=True)),
                        "goalsAgainst": parse_int(cells[7].get_text(strip=True)),
                        "points": parse_int(cells[-1].get_text(strip=True)),
                    })
                except:
                    pass
        print(f"   Classement: {len(ranking)} équipes")
    
    return {"matches": matches, "results": results, "ranking": ranking}


def parse_float(s):
    try:
        return float(str(s).replace(",", ".").strip())
    except:
        return 0.0

def parse_int(s):
    try:
        return int(re.sub(r"[^\d]", "", str(s)))
    except:
        return 0


def push_data(data):
    """Envoie les données vers Supabase"""
    import requests
    
    total = len(data.get('matches', [])) + len(data.get('results', [])) + len(data.get('ranking', []))
    print(f"📤 Envoi de {total} éléments...")
    
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
            print(f"✅ Succès! {datetime.now().strftime('%H:%M:%S')}")
        else:
            print(f"❌ Erreur: {result.get('error')}")
        return result
    except Exception as e:
        print(f"❌ Erreur d'envoi: {e}")
        return None


def main():
    print()
    print("=" * 50)
    print("SCRAPER - Version Termux")
    print("=" * 50)
    print(f"📍 Supabase: {DATABASE_URL}")
    print(f"⏱️  Intervalle: {REFRESH_INTERVAL}s")
    print()
    
    while True:
        try:
            print(f"\n{'─' * 40}")
            print(f"📅 {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}")
            print('─' * 40)
            
            data = scrape()
            
            if data:
                total = len(data.get("matches", [])) + len(data.get("results", [])) + len(data.get("ranking", []))
                if total > 0:
                    push_data(data)
                else:
                    print("⚠️ Aucune donnée extraite")
            else:
                print("❌ Échec du scraping")
                
        except KeyboardInterrupt:
            print("\n👋 Arrêt du scraper")
            break
        except Exception as e:
            print(f"❌ Erreur: {e}")
        
        print(f"\n⏳ Prochain scrape dans {REFRESH_INTERVAL}s...")
        time.sleep(REFRESH_INTERVAL)


if __name__ == "__main__":
    main()
