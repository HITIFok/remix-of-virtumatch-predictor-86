#!/usr/bin/env python3
"""
Scraper bet261.mg - Version DEBUG
=================================
Affiche la structure de l'API pour comprendre le format des cotes

Usage:
  python debug-api.py
"""

import json

# ============ CONFIGURATION ============
LEAGUE_ID = "8035"
API_BASE = f"https://hg-event-api-prod.sporty-tech.net/api/instantleagues/{LEAGUE_ID}"
API_MATCHES = f"{API_BASE}/matches"

# Headers requis
HEADERS = {
    "Origin": "https://bet261.mg",
    "Referer": "https://bet261.mg/",
    "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/137.0.0.0 Mobile Safari/537.36",
    "Accept": "application/json",
}


def main():
    import requests
    
    print("=" * 60)
    print("🔍 DEBUG API bet261.mg - Instant League")
    print("=" * 60)
    
    print(f"\n📡 Récupération de: {API_MATCHES}")
    
    try:
        resp = requests.get(API_MATCHES, headers=HEADERS, timeout=30)
        print(f"Status: {resp.status_code}")
        
        if resp.status_code == 200:
            data = resp.json()
            
            # Afficher la structure du premier match
            if "rounds" in data and len(data["rounds"]) > 0:
                matches = data["rounds"][0].get("matches", [])
                if matches:
                    m = matches[0]  # Premier match
                    
                    print("\n" + "=" * 60)
                    print("📋 PREMIER MATCH - Structure complète:")
                    print("=" * 60)
                    print(json.dumps(m, indent=2, ensure_ascii=False))
                    
                    print("\n" + "=" * 60)
                    print("💰 eventBetTypes - Structure des cotes:")
                    print("=" * 60)
                    
                    event_bet_types = m.get("eventBetTypes", [])
                    print(f"Nombre de eventBetTypes: {len(event_bet_types)}")
                    
                    for i, bet_type in enumerate(event_bet_types):
                        print(f"\n--- eventBetTypes[{i}] ---")
                        print(f"  name: {bet_type.get('name')}")
                        print(f"  Clés disponibles: {list(bet_type.keys())}")
                        
                        # Vérifier outcomes
                        if "outcomes" in bet_type:
                            print(f"  ✅ outcomes trouvé!")
                            for o in bet_type["outcomes"]:
                                print(f"     - type={o.get('type')}, odds={o.get('odds')}")
                        
                        # Vérifier eventBetTypeItems
                        if "eventBetTypeItems" in bet_type:
                            print(f"  ✅ eventBetTypeItems trouvé!")
                            for item in bet_type["eventBetTypeItems"]:
                                print(f"     - name={item.get('name')}, odd={item.get('odd')}")
                else:
                    print("❌ Aucun match trouvé")
            else:
                print("❌ Structure 'rounds' non trouvée")
                print("Clés disponibles:", list(data.keys()))
        else:
            print(f"❌ Erreur HTTP: {resp.status_code}")
            print(resp.text[:500])
            
    except Exception as e:
        print(f"❌ Erreur: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()
