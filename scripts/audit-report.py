#!/usr/bin/env python3
"""VirtuMatch Predictor — Comprehensive Audit Report"""

import os
from datetime import datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether, HRFlowable
)

OUTPUT = '/home/z/my-project/download/VirtuMatch-Audit-Report.pdf'

# Colors
C_ACCENT = HexColor('#6c5ce7')
C_FIRE = HexColor('#e74c3c')
C_GOLD = HexColor('#f39c12')
C_GRAY = HexColor('#7f8c8d')
C_LIGHT = HexColor('#ecf0f1')
C_DARK = HexColor('#2c3e50')
critC = HexColor('#c0392b')
highC = HexColor('#e67e22')
medC = HexColor('#f1c40f')
lowC = HexColor('#3498db')

styles = getSampleStyleSheet()
title_style = ParagraphStyle('Title', parent=styles['Title'], fontSize=28, textColor=C_ACCENT, spaceAfter=6*mm, alignment=TA_CENTER, fontName='Helvetica-Bold')
h1_style = ParagraphStyle('H1', parent=styles['Heading1'], fontSize=18, textColor=C_ACCENT, spaceAfter=4*mm, spaceBefore=8*mm, fontName='Helvetica-Bold')
h2_style = ParagraphStyle('H2', parent=styles['Heading2'], fontSize=14, textColor=C_DARK, spaceAfter=3*mm, spaceBefore=5*mm, fontName='Helvetica-Bold')
h3_style = ParagraphStyle('H3', parent=styles['Heading3'], fontSize=12, textColor=C_DARK, spaceAfter=2*mm, spaceBefore=4*mm, fontName='Helvetica-Bold')
body_style = ParagraphStyle('Body', parent=styles['Normal'], fontSize=10, textColor=black, spaceAfter=2*mm, leading=14, alignment=TA_JUSTIFY, fontName='Helvetica')

def h1(t): return Paragraph(t, h1_style)
def h2(t): return Paragraph(t, h2_style)
def h3(t): return Paragraph(t, h3_style)
def p(t): return Paragraph(t, body_style)
def sp(h=3): return Spacer(1, h*mm)
def hr(): return HRFlowable(width="100%", thickness=0.5, color=C_GRAY)

def make_table(headers, rows, col_widths=None):
    data = [headers] + rows
    t = Table(data, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), C_ACCENT),
        ('TEXTCOLOR', (0,0), (-1,0), white),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTSIZE', (0,0), (-1,-1), 8),
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [white, HexColor('#f8f9fa')]),
        ('GRID', (0,0), (-1,-1), 0.5, C_GRAY),
        ('LEFTPADDING', (0,0), (-1,-1), 4),
        ('RIGHTPADDING', (0,0), (-1,-1), 4),
        ('TOPPADDING', (0,0), (-1,-1), 3),
        ('BOTTOMPADDING', (0,0), (-1,-1), 3),
    ]))
    return t

doc = SimpleDocTemplate(OUTPUT, pagesize=A4, topMargin=20*mm, bottomMargin=20*mm, leftMargin=20*mm, rightMargin=20*mm)
story = []

# COVER
story.append(Spacer(1, 40*mm))
story.append(Paragraph('VirtuMatch Predictor', title_style))
story.append(Paragraph('Audit Complet - Phases 1 a 20', ParagraphStyle('Sub', parent=title_style, fontSize=16, textColor=C_FIRE, spaceAfter=10*mm)))
story.append(Paragraph(f'Genere le {datetime.now().strftime("%Y-%m-%d %H:%M")}', ParagraphStyle('Date', parent=body_style, alignment=TA_CENTER, textColor=C_GRAY)))
story.append(Spacer(1, 15*mm))
story.append(hr())
story.append(sp(5))
story.append(p('<b>Objectif</b> : Transformer VirtuMatch Predictor en une plateforme de prediction robuste, testable, rapide, securisee et statistiquement validee.'))
story.append(sp(3))
story.append(p('<b>Principe absolu</b> : Aucune amelioration n\'est valide sans justification mathematique, test, backtest et comparaison avant/apres. Priorite : calibration &gt; robustesse &gt; performance &gt; accuracy.'))
story.append(PageBreak())

# PHASE 1
story.append(h1('Phase 1 - Architecture Actuelle'))
story.append(p('VirtuMatch Predictor est une SPA React 18 + TypeScript + Vite 8 deployee sur Vercel Hobby (12 fonctions serverless max, timeout 10s). Base de donnees : Neon PostgreSQL (serverless). Android : Capacitor. IA : Groq (llama-3.3-70b-versatile).'))
story.append(h2('Stack Technique'))
story.append(make_table(['Composant', 'Technologie', 'Detail'], [
    ['Frontend', 'React + Vite + TypeScript', 'React 18, Vite 8.2, TS 5.x'],
    ['UI', 'Tailwind CSS + shadcn/ui + Radix', '47 composants UI, dark theme'],
    ['Backend', 'Vercel Serverless Functions', '12 fonctions (limite Hobby)'],
    ['Base de donnees', 'Neon PostgreSQL', 'Pooled connection string'],
    ['IA', 'Groq LLM', 'llama-3.3-70b-versatile, temp=0.3'],
    ['Mobile', 'Capacitor Android', 'com.hitif.virutelbet261'],
    ['Tests', 'Vitest', 'Couverture: ~0%'],
], col_widths=[70, 130, 260]))
story.append(sp(3))

story.append(h2('12 Fonctions Serverless'))
story.append(make_table(['Fonction', 'Lignes', 'Role'], [
    ['auth.js', '443', 'Magic link + APK proxy'],
    ['admin-codes.js', '434', 'Admin login/verify + codes CRUD'],
    ['analyze-match.js', '649', 'Groq IA + Poisson fallback'],
    ['predictions.js', '402', 'CRUD predictions'],
    ['verify-predictions.js', '408', 'Cron: verification resultats'],
    ['auto-playout.js', '652', 'Cron: playout scan multi-phase'],
    ['fetch-live.js', '535', 'Donnees live sporty-tech'],
    ['matches.js', '214', 'Proxy matches/ranking/results'],
    ['push-odds.js', '137', 'Ingestion scraper'],
    ['premium-activate.js', '338', 'Activation premium'],
    ['early-alerts.js', '149', 'Alertes resultats precoces'],
    ['device-register.js', '83', 'HMAC device registration'],
], col_widths=[100, 40, 320]))
story.append(sp(3))

story.append(h2('Problemes Architecturaux'))
story.append(make_table(['ID', 'Probleme', 'Severite', 'Impact'], [
    ['A-01', 'Couverture tests ~0%', 'CRITICAL', 'Aucune regression detectable'],
    ['A-02', '12/12 fonctions Vercel (zero marge)', 'HIGH', 'Impossible d\'ajouter endpoints'],
    ['A-03', 'Moteur prediction monolithique (1344 lignes)', 'HIGH', 'Intestable, inmaintenable'],
    ['A-04', 'Logique Poisson dupliquee frontend/backend', 'HIGH', 'Divergence des resultats'],
    ['A-05', 'Connexions SQL par fichier (pas de pooling)', 'MEDIUM', 'Gaspillage Neon compute'],
    ['A-06', 'legacy/supabase/ present (~6500 lignes)', 'LOW', 'Confusion, bruit repo'],
    ['A-07', 'strictNullChecks: false', 'MEDIUM', 'Bugs silencieux TypeScript'],
], col_widths=[35, 200, 60, 165]))
story.append(PageBreak())

# PHASE 2
story.append(h1('Phase 2 - Audit de Securite'))
story.append(p('25 vulnerabilites identifiees : 3 CRITICAL, 6 HIGH, 10 MEDIUM, 6 LOW. La chaine d\'attaque la plus critique combine 3 failles permettant a n\'importe quel site web d\'usurper n\'importe quel utilisateur.'))

story.append(h2('CRITICAL'))
for vid, loc, title, scenario in [
    ('V-01', 'api/_lib/auth.js:195-222', 'Legacy requireAuth() bypass HMAC', 'curl -H "x-device-id: dev-victim01" → acces total sans auth. Device IDs previsibles.'),
    ('V-02', 'api/_lib/cors.js:27', 'CORS bypass via x-capacitor-request', 'Header trivialement spoofable. Tout site web peut faire des requetes cross-origin.'),
    ('V-03', 'vercel.json:31', 'CSP unsafe-inline dans script-src', 'Tout XSS injecte via &lt;script&gt; s\'execute. CSP premiere ligne de defense.'),
]:
    story.append(KeepTogether([
        Paragraph(f'<font color="{critC.hexval()}"><b>[CRITICAL] {vid}</b></font> - <b>{title}</b>', h3_style),
        p(f'<b>Fichier</b> : {loc}'),
        p(f'<b>Scenario</b> : {scenario}'),
        sp(2)
    ]))

story.append(h2('Chaine d\'Attaque (V-01 + V-02 + V-04)'))
story.append(p('<b>1)</b> V-02: x-capacitor-request: true → CORS bypass. <b>2)</b> V-01: x-device-id: dev-victim01 → Auth bypass. <b>3)</b> V-04: Rate limiting in-memory vide sur cold start. <b>Resultat</b> : Tout site web peut usurper tout utilisateur, lire/ecrire/supprimer predictions, activer codes premium.'))

story.append(h2('HIGH'))
for vid, loc, title, scenario in [
    ('V-04', 'middleware.js + 4 fichiers', 'Rate limiting in-memory inefficace serverless', 'Cold start reset Maps. Instances paralleles sans etat partage.'),
    ('V-05', 'middleware.js:53', 'x-forwarded-for spoofable (1er IP)', 'Attaqueur controle cle de rate-limit.'),
    ('V-06', 'api/_lib/auth.js:118', 'Tokens HMAC rejeuables 7 jours', 'Token capture → 7 jours d\'acces sans revocation.'),
    ('V-07', 'api/_lib/auth.js:235', 'Session user 30 jours sans revocation', 'Bearer token leake → 30 jours d\'acces.'),
    ('V-08', 'api/premium-activate.js:212', 'Enumeration codes premium', '"Code non trouve" vs " deja utilise" → brute force.'),
    ('V-09', 'vercel.json:31', 'CSP connect-src *.vercel.app', 'XSS → exfiltration vers deployment attaquant.'),
]:
    story.append(KeepTogether([
        Paragraph(f'<font color="{highC.hexval()}"><b>[HIGH] {vid}</b></font> - {title}', h3_style),
        p(f'<b>Fichier</b> : {loc}'),
        p(f'<b>Scenario</b> : {scenario}'),
        sp(2)
    ]))

story.append(h2('Actions Prioritaires'))
story.append(p('1. <b>Supprimer fallbacks requireAuth()</b> (V-01)<br/>2. <b>Remplacer check x-capacitor-request</b> par validation d\'origine (V-02)<br/>3. <b>Retirer unsafe-inline de script-src</b> (V-03)<br/>4. <b>Deployer Upstash/Vercel KV rate limiting</b> (V-04)<br/>5. <b>Corriger extraction IP</b> : dernier x-forwarded-for ou x-real-ip (V-05)'))
story.append(PageBreak())

# PHASE 3
story.append(h1('Phase 3 - Audit du Moteur de Prediction'))
story.append(p('Le moteur (prediction-engine.ts 1342 lignes + analyze-match.js 649 lignes) implemente Poisson + grid search + stats + forme + H2H + IA + redistribution virtuelle. <b>17 coefficients arbitraires</b> sans justification empirique, risque de data leakage, zero backtesting.'))

story.append(h2('Coefficients Arbitraires'))
story.append(make_table(['Coefficient', 'Valeur', 'Localisation', 'Justification'], [
    ['Stats blend 70/20/10', '0.70/0.20/0.10', 'adjustLambdasWithStats()', 'Aucune'],
    ['AI_WEIGHT', '0.35 (35%)', 'blendWithAI()', '65% maths + 35% IA non calibre'],
    ['VIRTUAL_AVG_GOALS', '1.3', 'Constante globale', 'Non verifie historiquement'],
    ['Form attack boost', '0.15', 'adjustLambdasWithHistory()', 'Arbitraire'],
    ['Form defense penalty', '0.10', 'adjustLambdasWithHistory()', 'Arbitraire'],
    ['Momentum divisor', '500', 'adjustLambdasWithHistory()', 'Resultat: -0.10 a +0.10'],
    ['Confidence base cap', '68% (prob*85)', 'calculateMultiFactorConfidence()', '85% et 68% non calibres'],
    ['Confidence ceiling', '82%', 'calculateMultiFactorConfidence()', 'Pourquoi 82?'],
    ['Anti-trap penalty', '-5 per alert', 'calculateMultiFactorConfidence()', '5 points par alerte'],
    ['True trap penalty', '-12', 'calculateMultiFactorConfidence()', '12 points'],
    ['Lambda clamp', '[0.3, 2.8]', 'Clamp global', 'Non justifie empiriquement'],
    ['Grid step/range', '0.05 / [0.5,3.0]', 'gridSearchLambdas()', 'Precision/Perf non mesure'],
    ['HT lambda ratio', '0.46', 'calculateHalfTimeScore()', 'Non verifie'],
    ['New season boost', '+0.22', 'analyzeMatch()', 'Arbitraire'],
], col_widths=[80, 60, 120, 200]))
story.append(sp(3))

story.append(h2('Risques Statistiques'))
story.append(make_table(['ID', 'Risque', 'Severite', 'Description'], [
    ['S-01', 'Zero backtesting', 'CRITICAL', 'Aucune validation walk-forward. Modele bat-il les baselines? Inconnu.'],
    ['S-02', 'Data leakage potentiel', 'HIGH', 'Stats de la saison en cours pour predire matchs de la meme saison.'],
    ['S-03', 'Confiance non calibree', 'HIGH', '70% annonce ne signifie pas 70% correct. Pas de reliability diagram.'],
    ['S-04', 'Poisson independent', 'MEDIUM', 'Suppose buts home/away independants. Correlation possible en virtuel.'],
    ['S-05', 'Anti-trap heuristique', 'MEDIUM', '5 alertes poids egaux, sans mesure de contribution individuelle.'],
    ['S-06', 'Redistribution ad-hoc', 'MEDIUM', 'Bonus scores virtuels (0-0: 1.15...) non derives de donnees.'],
    ['S-07', 'Duplication frontend/backend', 'HIGH', 'Meme Poisson en TS et JS, divergence inevitable.'],
], col_widths=[35, 120, 60, 245]))
story.append(PageBreak())

# PHASES 4-6
story.append(h1('Phases 4-6 - Backtest, Baselines, Metriques'))
story.append(h2('Phase 4 - Framework de Backtesting'))
story.append(p('Framework walk-forward <b>obligatoire</b> avant toute modification du moteur. Principe : donnees futures JAMAIS utilisees pour predire le passe. Requis : validation walk-forward, rolling window, expanding window, metriques par periode/ligue/confiance.'))
story.append(h2('Phase 5 - Baselines'))
story.append(make_table(['Modele', 'Description', 'Complexite'], [
    ['A', 'Probabilites implicites des cotes', 'Minimal'],
    ['B', 'Poisson (cotes only)', 'Faible'],
    ['C', 'Poisson + stats equipe', 'Moyen'],
    ['D', 'Poisson + forme', 'Moyen'],
    ['E', 'Poisson + H2H', 'Moyen'],
    ['F', 'Poisson + stats + forme + H2H', 'Eleve'],
    ['G', 'Modele complet actuel', 'Eleve'],
    ['H', 'Modele complet + IA Groq', 'T. Eleve'],
], col_widths=[40, 200, 100]))
story.append(h2('Phase 6 - Metriques Obligatoires'))
story.append(p('Accuracy, Precision, Recall, F1, Log Loss, Brier Score, Calibration Error, Confusion Matrix. Pour probabilites : reliability diagram, ECE. Si modele annonce 70% sur 1000 matchs, frequence reelle doit etre proche de 70%.'))
story.append(PageBreak())

# PHASES 7-11
story.append(h1('Phases 7-11 - Refactoring, Calibration, IA, Virtuel, Anti-Trap'))
story.append(h2('Phase 7 - Refactoring'))
story.append(p('Decomposer prediction-engine.ts en 13 modules : odds.ts, poisson.ts, features.ts, form.ts, h2h.ts, team-strength.ts, score-matrix.ts, virtual-model.ts, ai-blender.ts, confidence.ts, markets.ts, trap-detector.ts, prediction-engine.ts. Fichier principal orchestre uniquement.'))
story.append(h2('Phase 8 - Calibration'))
story.append(p('Remplacer confiance heuristique par probabilite calibree. Methodes : Platt Scaling, Isotonic Regression, Beta Calibration. Choisir meilleure via validation temporelle. Afficher "Probabilite modele : 68%" avec "Calibration : bonne/moyenne/faible".'))
story.append(h2('Phase 9 - IA Groq'))
story.append(p('IA = challenger du modele statistique, jamais modificateur arbitraire. Si BASE + IA n\'amel10,iore pas Brier/LogLoss/calibration, reduire/supprimer influence (actuellement 35%). Fallback mathematique systematique.'))
story.append(h2('Phase 10 - Football Virtuel'))
story.append(p('Ne pas supposer distributions reel = virtuel. Analyser : moyenne buts, variance, freq 0-0/1-0/1-1, draw rate, home win rate, dependance buts. Tester Poisson vs Dixon-Coles vs bivariate Poisson vs modele empirique.'))
story.append(h2('Phase 11 - Anti-Trap'))
story.append(p('Transformer trap detection en feature statistique. Mesurer performance quand antiTrapAlerts = 0, 1, 2, &gt;= 3. Supprimer signaux sans amelioration statistiquement significative.'))
story.append(PageBreak())

# PHASES 12-14
story.append(h1('Phases 12-14 - Rate Limiting, Auth, CSP'))
story.append(h2('Phase 12 - Rate Limiting Persistant'))
story.append(p('Remplacer Map() memoire par Upstash Redis ou Vercel KV. Proteger : predictions, premium-activate, admin-codes?action=login, device-register, analyze-match, verify-predictions.'))
story.append(h2('Phase 13 - Authentification'))
story.append(p('Supprimer fallback plain x-device-id. HMAC obligatoire, timestamp expiration, protection replay, rotation secrets, revocation. Tester scenarii IDOR explicitement.'))
story.append(h2('Phase 14 - CSP Renforcee'))
story.append(p('Retirer unsafe-inline de script-src. Nonce-based CSP. Restreindre connect-src a self + URL Vercel specifique + sporty-tech.'))
story.append(PageBreak())

# PHASES 15-18
story.append(h1('Phases 15-18 - Tests, Performance, Observabilite, Versioning'))
story.append(h2('Phase 15 - Tests'))
story.append(p('Minimum 11 fichiers test : odds, poisson, form, h2h, lambdas, score-matrix, virtual-model, confidence, trap-detector, markets, prediction-engine. Plus tests API et non-regression.'))
story.append(h2('Phase 16 - Performance'))
story.append(p('Identifier : SQL lentes, connexions excessives, Poisson repetes (grid O(n^2)), appels Groq inutiles (&gt;3 matches = math fallback), re-renders React, bundle size. Optimiser sans modifier resultats mathematiques.'))
story.append(h2('Phase 17 - Observabilite'))
story.append(p('Metriques : prediction_latency, api_latency, db_latency, groq_latency, prediction_provider, prediction_confidence, model_version. Chaque prediction tracable.'))
story.append(h2('Phase 18 - Versionnement'))
story.append(p('MODEL_VERSION (ex: "poisson-v3-calibrated") + FEATURE_VERSION (ex: "features-v2"). Chaque prediction enregistree conserve la version.'))
story.append(PageBreak())

# PHASES 19-20
story.append(h1('Phases 19-20 - Regle Absolue + Livrable Final'))
story.append(h2('Phase 19 - Regle Absolue'))
story.append(p('<b>NE PAS chercher simplement a augmenter l\'accuracy.</b> Augmentation d\'accuracy au detriment de calibration/generalisation = <font color="#c0392b"><b>regression</b></font>. Priorite : 1) Qualite probabilites (Brier, LogLoss) 2) Calibration (ECE) 3) Robustesse out-of-sample 4) Stabilite 5) Performance 6) Accuracy'))
story.append(h2('Phase 20 - Resume'))
story.append(make_table(['Priorite', 'Categorie', 'Count', 'Action'], [
    ['CRITICAL', 'Securite (auth bypass, CORS, CSP)', '3', 'Corriger V-01, V-02, V-03'],
    ['CRITICAL', 'Statistique (zero backtest)', '1', 'Framework backtest avant tout changement'],
    ['CRITICAL', 'Qualite (0% test coverage)', '1', 'Tests unitaires minimaux'],
    ['HIGH', 'Securite (rate limit, tokens, IDOR)', '6', 'Upstash KV, token rotation, IP fix'],
    ['HIGH', 'Statistique (coefficients arbitraires)', '17', 'Calibrer via backtest'],
    ['HIGH', 'Architecture (monolithe, duplication)', '3', 'Refactoring en modules'],
    ['MEDIUM', 'Securite (race conditions, info leak)', '10', 'Transaction locks, generic errors'],
    ['MEDIUM', 'Performance (SQL, Poisson, bundle)', '4', 'Pooling, cache, tree-shaking'],
    ['LOW', 'Securite (logs, CSRF, GET tokens)', '6', 'Clean logs, POST-only verify'],
], col_widths=[60, 170, 40, 190]))
story.append(sp(5))

story.append(h2('Plan de Migration Recommande'))
story.append(p('<b>Etape 1 (Urgent - Securite)</b> : Supprimer fallback requireAuth, fix CORS, fix CSP, deploy Upstash KV<br/><br/><b>Etape 2 (Fondation - Tests)</b> : Creer framework backtest, tests unitaires minimaux<br/><br/><b>Etape 3 (Calibration)</b> : Backtester Modeles A-H, calibrer confiance, mesurer ECE/Brier/LogLoss<br/><br/><b>Etape 4 (Refactoring)</b> : Decomposer prediction-engine.ts en 13 modules<br/><br/><b>Etape 5 (Optimisation)</b> : SQL pooling, cache Poisson, model versioning, observabilite<br/><br/><b>Etape 6 (Validation continue)</b> : Backtest automatique sur chaque modification du moteur, comparaison avant/apres obligatoire'))

# Build
doc.build(story)
print(f'PDF generated: {OUTPUT}')
print(f'Size: {os.path.getsize(OUTPUT) / 1024:.1f} KB')
