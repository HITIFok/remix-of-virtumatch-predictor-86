#!/usr/bin/env python3
"""
Scraper local bet261.mg - À exécuter depuis Madagascar
========================================================
Ce script scrape les données Instant League de bet261.mg
et les envoie vers votre application Lovable.

Installation:
  pip install requests beautifulsoup4 selenium webdriver-manager

Usage:
  python scraper-local.py

Configuration:
  Modifiez les variables ci-dessous selon votre setup.
"""

import json
import time
import re
import sys
from datetime import datetime

# ============ CONFIGURATION ============
# URL de votre projet Supabase
SUPABASE_URL = "REDACTED_SUPABASE_URL"
PUSH_ENDPOINT = f"{SUPABASE_URL}/functions/v1/push-odds"

# Clé d'authentification (même valeur que SCRAPER_PUSH_KEY dans Edge Functions > Secrets)
PUSH_KEY = "REDACTED_PUSH_KEY"

# Publishable key (anon) pour l'en-tête apikey
ANON_KEY = "REDACTED_ANON_KEY"

# Intervalle de rafraîchissement (secondes)
REFRESH_INTERVAL = 120  # 2 minutes

# URL cible
TARGET_URL = "https://bet261.mg/virtual/category/instant-league"

# ============ SCRAPING ============

def scrape_with_selenium():
    """Scrape bet261.mg en utilisant Selenium (navigateur headless)"""
    try:
        from selenium import webdriver
        from selenium.webdriver.chrome.service import Service
        from selenium.webdriver.chrome.options import Options
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC
        from webdriver_manager.chrome import ChromeDriverManager
    except ImportError:
        print("❌ Installez selenium: pip install selenium webdriver-manager")
        return None

    options = Options()
    options.add_argument("--headless")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--window-size=1920,1080")
    # Ignorer les erreurs SSL/certificat
    options.add_argument("--ignore-certificate-errors")
    options.add_argument("--ignore-ssl-errors")
    options.add_argument("--allow-insecure-localhost")

    print(f"🌐 Ouverture de {TARGET_URL}...")
    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)
    
    # Augmenter le timeout de la page
    driver.set_page_load_timeout(60)
    driver.set_script_timeout(30)

    try:
        driver.get(TARGET_URL)
        
        # Attendre plus longtemps pour le rendu Angular
        print("⏳ Attente du chargement de la page...")
        time.sleep(5)
        
        # Essayer d'attendre les éléments, mais continuer même si timeout
        try:
            WebDriverWait(driver, 30).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "hg-instant-league-matches, hg-instant-league-ranking, .match, table"))
            )
        except:
            print("⚠️ Timeout sur les éléments, mais on continue...")
        
        time.sleep(5)  # Attendre le rendu Angular

        html = driver.page_source
        print(f"✅ Page chargée ({len(html)} caractères)")
        
        # Vérifier si accès interdit
        if "ACCESS FORBIDDEN" in html or "Forbidden" in driver.title:
            print("❌ ACCÈS INTERDIT - vérifiez que vous êtes bien à Madagascar")
            return None
        
        # Sauvegarder le HTML pour debug
        debug_file = "debug_bet261.html"
        with open(debug_file, "w", encoding="utf-8") as f:
            f.write(html)
        print(f"💾 HTML sauvegardé dans: {debug_file}")
        
        # Vérifier le titre de la page
        print(f"📄 Titre de la page: {driver.title}")
        
        # Vérifier s'il y a des iframes
        iframes = driver.find_elements(By.TAG_NAME, "iframe")
        print(f"🖼️ Iframes trouvés: {len(iframes)}")
        
        # Attendre encore un peu pour le rendu Angular
        print("⏳ Attente supplémentaire pour le rendu Angular...")
        time.sleep(10)  # Attendre 10 secondes de plus
        html = driver.page_source
        print(f"✅ HTML après attente: ({len(html)} caractères)")

        data = parse_html(html, driver)
        return data

    finally:
        driver.quit()


def scrape_with_requests():
    """Tentative simple avec requests (peut ne pas fonctionner si JS requis)"""
    import requests
    from bs4 import BeautifulSoup
    import urllib3
    
    # Désactiver les warnings SSL
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

    print(f"🌐 Tentative GET simple sur {TARGET_URL}...")
    resp = requests.get(TARGET_URL, timeout=30, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }, verify=False)

    if "ACCESS FORBIDDEN" in resp.text:
        print("❌ Accès interdit - vérifiez que vous êtes bien à Madagascar")
        return None

    if len(resp.text) < 500:
        print("⚠️ Contenu trop court, le site nécessite JavaScript. Utilisez Selenium.")
        return None

    return parse_html(resp.text)


def parse_html(html, driver=None):
    """Parse le HTML pour extraire matchs, résultats et classement"""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    matches = []
    results = []
    ranking = []
    
    # Debug: afficher un extrait du HTML
    print(f"🔍 Analyse du HTML...")
    
    # Vérifier si la page contient des éléments instant-league
    instant_league = soup.find_all(class_=re.compile("instant-league", re.I))
    hg_elements = soup.find_all(re.compile("^hg-"))
    print(f"   Éléments 'instant-league': {len(instant_league)}")
    print(f"   Éléments 'hg-*': {len(hg_elements)}")

    # Parse les matchs - plusieurs sélecteurs possibles
    selectors = [
        "hg-instant-league-matches .match",
        "hg-instant-league-matches .match-row",
        ".match-row",
        ".event-row",
        ".match-item",
        "[class*='match']"
    ]
    
    match_elements = []
    for selector in selectors:
        match_elements = soup.select(selector)
        if match_elements:
            print(f"   Matchs trouvés avec '{selector}': {len(match_elements)}")
            break
    
    if not match_elements:
        print("   ⚠️ Aucun match trouvé avec les sélecteurs connus")
        # Chercher tous les éléments avec 'match' dans la classe
        all_matches = soup.find_all(class_=re.compile("match", re.I))
        print(f"   Éléments avec 'match' dans la classe: {len(all_matches)}")
    for el in match_elements:
        try:
            home_el = el.select_one(".home, .team-home, .team:first-child")
            away_el = el.select_one(".away, .team-away, .team:last-child")
            odds_els = el.select(".odd, .odds-value, .coefficient")

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

                # Kickoff time
                time_el = el.select_one(".time, .kickoff, .match-time")
                if time_el:
                    match["kickoff"] = time_el.get_text(strip=True)

                matches.append(match)
        except Exception as e:
            print(f"⚠️ Erreur parsing match: {e}")

    # Parse le classement
    ranking_table = soup.select_one("hg-instant-league-ranking table, .ranking-table, .standings table")
    if ranking_table:
        rows = ranking_table.select("tbody tr, tr")[1:]  # Skip header
        for row in rows:
            cells = row.select("td")
            if len(cells) >= 9:
                try:
                    ranking.append({
                        "position": parse_int(cells[0].get_text(strip=True)),
                        "team": cells[1].get_text(strip=True),
                        "played": parse_int(cells[2].get_text(strip=True)),
                        "won": parse_int(cells[3].get_text(strip=True)),
                        "drawn": parse_int(cells[4].get_text(strip=True)),
                        "lost": parse_int(cells[5].get_text(strip=True)),
                        "goalsFor": parse_int(cells[6].get_text(strip=True)),
                        "goalsAgainst": parse_int(cells[7].get_text(strip=True)),
                        "points": parse_int(cells[-1].get_text(strip=True)),
                    })
                except Exception as e:
                    print(f"⚠️ Erreur parsing classement: {e}")

    # Si Selenium dispo, cliquer sur l'onglet Résultats
    if driver:
        try:
            from selenium.webdriver.common.by import By
            tabs = driver.find_elements(By.CSS_SELECTOR, "div.tab-picker div")
            for tab in tabs:
                if "résultat" in tab.text.lower() or "result" in tab.text.lower():
                    tab.click()
                    time.sleep(2)
                    results_html = driver.page_source
                    results_soup = BeautifulSoup(results_html, "html.parser")
                    result_rows = results_soup.select(".result-row, .match-result, .finished-match")
                    for row in result_rows:
                        try:
                            home = row.select_one(".home, .team-home")
                            away = row.select_one(".away, .team-away")
                            score = row.select_one(".score, .result-score")
                            if home and away and score:
                                score_text = score.get_text(strip=True)
                                score_parts = re.split(r"[-:]", score_text)
                                if len(score_parts) == 2:
                                    results.append({
                                        "home": home.get_text(strip=True),
                                        "away": away.get_text(strip=True),
                                        "scoreHome": parse_int(score_parts[0]),
                                        "scoreAway": parse_int(score_parts[1]),
                                        "league": "Instant League",
                                    })
                        except Exception as e:
                            print(f"⚠️ Erreur parsing résultat: {e}")
                    break
        except Exception as e:
            print(f"⚠️ Impossible de charger les résultats: {e}")

    return {"matches": matches, "results": results, "ranking": ranking}


def parse_float(s):
    try:
        return float(s.replace(",", "."))
    except:
        return 0.0

def parse_int(s):
    try:
        return int(re.sub(r"[^\d]", "", s))
    except:
        return 0


# ============ PUSH DATA ============

def push_data(data):
    """Envoie les données vers l'application"""
    import requests

    print(f"📤 Envoi: {len(data.get('matches', []))} matchs, {len(data.get('results', []))} résultats, {len(data.get('ranking', []))} classement")

    resp = requests.post(
        PUSH_ENDPOINT,
        json=data,
        headers={
            "Content-Type": "application/json",
            "x-push-key": PUSH_KEY,
            "apikey": ANON_KEY,
        },
        timeout=15,
    )

    result = resp.json()
    if result.get("success"):
        print(f"✅ Données envoyées avec succès à {datetime.now().strftime('%H:%M:%S')}")
    else:
        print(f"❌ Erreur: {result.get('error')}")

    return result


# ============ MAIN ============

def main():
    if PUSH_KEY == "VOTRE_CLE_ICI":
        print("⚠️  Configurez d'abord PUSH_KEY dans ce script!")
        print("   Utilisez la même valeur que SCRAPER_PUSH_KEY dans les secrets de l'app.")
        sys.exit(1)

    print("=" * 50)
    print("🏟️  Scraper bet261.mg - Instant League")
    print("=" * 50)
    print(f"📍 Intervalle: {REFRESH_INTERVAL}s")
    print()

    while True:
        try:
            # Essayer Selenium d'abord, puis requests
            try:
                data = scrape_with_selenium()
            except Exception as e:
                print(f"⚠️ Selenium échoué: {e}")
                data = scrape_with_requests()

            if data:
                total = len(data.get("matches", [])) + len(data.get("results", [])) + len(data.get("ranking", []))
                if total > 0:
                    push_data(data)
                else:
                    print("⚠️ Aucune donnée extraite. La structure du site a peut-être changé.")
            else:
                print("❌ Échec du scraping")

        except Exception as e:
            print(f"❌ Erreur: {e}")

        print(f"\n⏳ Prochain rafraîchissement dans {REFRESH_INTERVAL}s...")
        time.sleep(REFRESH_INTERVAL)


if __name__ == "__main__":
    main()
