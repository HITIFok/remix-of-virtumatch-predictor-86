#!/usr/bin/env python3
"""
VirtuMatch Predictor — Audit Complet du Repository
Génère un rapport PDF avec ReportLab
"""

import hashlib
from datetime import datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm, cm
from reportlab.lib.colors import HexColor, white, black
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether, HRFlowable
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily

# ─── Font Registration ─────────────────────────────────────────────────────
FONT_DIR = '/usr/share/fonts'

pdfmetrics.registerFont(TTFont('NotoSerifSC', f'{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Regular.ttf'))
pdfmetrics.registerFont(TTFont('NotoSerifSC-Bold', f'{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Bold.ttf'))
registerFontFamily('NotoSerifSC', normal='NotoSerifSC', bold='NotoSerifSC-Bold')

# NotoSansSC is a variable font that doesn't work with ReportLab TTFont
# Use NotoSerifSC for everything (both normal and bold available as static fonts)
# We just alias NotoSansSC to NotoSerifSC for consistency

# ─── Colors ─────────────────────────────────────────────────────────────────
C_BG = HexColor('#0a0a1a')
C_PRIMARY = HexColor('#6c5ce7')
C_ACCENT = HexColor('#e17055')
C_TEXT = HexColor('#2d3436')
C_TEXT_LIGHT = HexColor('#636e72')
C_TABLE_HEADER = HexColor('#2d3436')
C_TABLE_ALT = HexColor('#f8f9fa')
C_GREEN = HexColor('#00b894')
C_RED = HexColor('#d63031')
C_ORANGE = HexColor('#fdcb6e')
C_BLUE = HexColor('#0984e3')

# ─── Styles ─────────────────────────────────────────────────────────────────
styles = getSampleStyleSheet()

style_title = ParagraphStyle(
    'CustomTitle', parent=styles['Title'],
    fontName='NotoSerifSC-Bold', fontSize=22, leading=28,
    textColor=C_PRIMARY, spaceAfter=6*mm, alignment=TA_CENTER
)

style_h1 = ParagraphStyle(
    'CustomH1', parent=styles['Heading1'],
    fontName='NotoSerifSC-Bold', fontSize=16, leading=20,
    textColor=C_PRIMARY, spaceBefore=8*mm, spaceAfter=4*mm,
    borderPadding=2*mm
)

style_h2 = ParagraphStyle(
    'CustomH2', parent=styles['Heading2'],
    fontName='NotoSerifSC-Bold', fontSize=13, leading=16,
    textColor=HexColor('#34495e'), spaceBefore=5*mm, spaceAfter=3*mm
)

style_h3 = ParagraphStyle(
    'CustomH3', parent=styles['Heading3'],
    fontName='NotoSerifSC-Bold', fontSize=11, leading=14,
    textColor=HexColor('#2c3e50'), spaceBefore=4*mm, spaceAfter=2*mm
)

style_body = ParagraphStyle(
    'CustomBody', parent=styles['Normal'],
    fontName='NotoSerifSC', fontSize=9.5, leading=14,
    textColor=C_TEXT, spaceAfter=2*mm, alignment=TA_JUSTIFY
)

style_body_small = ParagraphStyle(
    'CustomBodySmall', parent=style_body,
    fontSize=8.5, leading=12
)

style_bullet = ParagraphStyle(
    'CustomBullet', parent=style_body,
    leftIndent=8*mm, bulletIndent=3*mm,
    spaceAfter=1.5*mm
)

style_table_header = ParagraphStyle(
    'TableHeader', parent=style_body,
    fontName='NotoSerifSC-Bold', fontSize=8.5, leading=11,
    textColor=white, alignment=TA_CENTER
)

style_table_cell = ParagraphStyle(
    'TableCell', parent=style_body,
    fontName='NotoSerifSC', fontSize=8.5, leading=11,
    textColor=C_TEXT, alignment=TA_LEFT
)

style_table_cell_center = ParagraphStyle(
    'TableCellCenter', parent=style_table_cell,
    alignment=TA_CENTER
)

style_code = ParagraphStyle(
    'CustomCode', parent=style_body,
    fontName='NotoSerifSC', fontSize=8, leading=10,
    textColor=HexColor('#555555'), leftIndent=5*mm,
    backColor=HexColor('#f1f3f5'), borderPadding=2*mm
)

style_footer = ParagraphStyle(
    'Footer', parent=style_body,
    fontName='NotoSerifSC', fontSize=7, leading=9,
    textColor=C_TEXT_LIGHT, alignment=TA_CENTER
)

# ─── Helpers ────────────────────────────────────────────────────────────────
def h1(text):
    return Paragraph(text, style_h1)

def h2(text):
    return Paragraph(text, style_h2)

def h3(text):
    return Paragraph(text, style_h3)

def p(text):
    return Paragraph(text, style_body)

def p_small(text):
    return Paragraph(text, style_body_small)

def bullet(text):
    return Paragraph(f'<bullet>&bull;</bullet> {text}', style_bullet)

def code(text):
    return Paragraph(text, style_code)

def spacer(h=3):
    return Spacer(1, h*mm)

def hr():
    return HRFlowable(width="100%", thickness=0.5, color=HexColor('#dee2e6'), spaceBefore=2*mm, spaceAfter=2*mm)

def make_table(headers, rows, col_widths=None):
    """Create a styled table."""
    header_row = [Paragraph(h, style_table_header) for h in headers]
    data = [header_row]
    for row in rows:
        data.append([Paragraph(str(c), style_table_cell) if i == 0 else Paragraph(str(c), style_table_cell_center)
                      for i, c in enumerate(row)])

    n_cols = len(headers)
    if col_widths is None:
        available = 170*mm
        col_widths = [available / n_cols] * n_cols

    t = Table(data, colWidths=col_widths, repeatRows=1)
    style_cmds = [
        ('BACKGROUND', (0, 0), (-1, 0), C_TABLE_HEADER),
        ('TEXTCOLOR', (0, 0), (-1, 0), white),
        ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('GRID', (0, 0), (-1, -1), 0.5, HexColor('#dee2e6')),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
    ]
    for i in range(1, len(data)):
        if i % 2 == 0:
            style_cmds.append(('BACKGROUND', (0, i), (-1, i), C_TABLE_ALT))
    t.setStyle(TableStyle(style_cmds))
    return t

def status_badge(status):
    colors = {'OK': C_GREEN, 'WARN': C_ORANGE, 'CRIT': C_RED, 'INFO': C_BLUE}
    c = colors.get(status, C_TEXT_LIGHT)
    return f'<font color="{c.hexval()}"><b>[{status}]</b></font>'

# ─── Page template with footer ─────────────────────────────────────────────
def add_page_number(canvas, doc):
    canvas.saveState()
    canvas.setFont('NotoSerifSC', 7)
    canvas.setFillColor(C_TEXT_LIGHT)
    canvas.drawCentredString(A4[0]/2, 10*mm, f"VirtuMatch Audit Report — Page {doc.page}")
    canvas.restoreState()

# ─── Build the document ────────────────────────────────────────────────────
OUTPUT = '/home/z/my-project/download/VirtuMatch-Audit-Report.pdf'

doc = SimpleDocTemplate(
    OUTPUT, pagesize=A4,
    leftMargin=20*mm, rightMargin=20*mm,
    topMargin=20*mm, bottomMargin=20*mm,
    title="VirtuMatch Predictor - Audit Complet",
    author="Z.ai",
    subject="Audit technique complet du repository VirtuMatch Predictor"
)

story = []

# ═══════════════════════════════════════════════════════════════════════════
# COVER PAGE
# ═══════════════════════════════════════════════════════════════════════════
story.append(Spacer(1, 30*mm))
story.append(Paragraph("VIRTUMATCH PREDICTOR", ParagraphStyle(
    'CoverTitle', fontName='NotoSerifSC-Bold', fontSize=28, leading=34,
    textColor=C_PRIMARY, alignment=TA_CENTER
)))
story.append(Spacer(1, 5*mm))
story.append(HRFlowable(width="60%", thickness=2, color=C_PRIMARY, spaceBefore=0, spaceAfter=0))
story.append(Spacer(1, 5*mm))
story.append(Paragraph("Audit Technique Complet du Repository", ParagraphStyle(
    'CoverSubtitle', fontName='NotoSerifSC', fontSize=16, leading=20,
    textColor=HexColor('#636e72'), alignment=TA_CENTER
)))
story.append(Spacer(1, 8*mm))
story.append(Paragraph(f"Genere le {datetime.now().strftime('%d/%m/%Y a %H:%M')}", ParagraphStyle(
    'CoverDate', fontName='NotoSerifSC', fontSize=10, leading=13,
    textColor=HexColor('#b2bec3'), alignment=TA_CENTER
)))
story.append(Spacer(1, 30*mm))

# Cover summary stats
cover_data = [
    ["Metrique", "Valeur"],
    ["Endpoints API actifs", "12 (limite Vercel Hobby)"],
    ["Fichiers source (src/)", "~60 fichiers .tsx/.ts"],
    ["Scripts Python/Node", "~15 scripts"],
    ["Workflows CI/CD", "3 (build-apk, scrape-cron, branch-guard)"],
    ["Migrations DB", "5 (001 a 005)"],
    ["Dependances npm", "~76 (prod + dev)"],
    ["Tables DB principales", "8+ (predictions, users, device_secrets, etc.)"],
]
cover_table = Table(cover_data, colWidths=[80*mm, 90*mm])
cover_table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), C_PRIMARY),
    ('TEXTCOLOR', (0, 0), (-1, 0), white),
    ('FONTNAME', (0, 0), (-1, 0), 'NotoSerifSC-Bold'),
    ('FONTSIZE', (0, 0), (-1, -1), 9),
    ('FONTNAME', (0, 1), (-1, -1), 'NotoSerifSC'),
    ('GRID', (0, 0), (-1, -1), 0.5, HexColor('#dee2e6')),
    ('TOPPADDING', (0, 0), (-1, -1), 4),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ('LEFTPADDING', (0, 0), (-1, -1), 6),
    ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
    ('BACKGROUND', (0, 2), (-1, 2), C_TABLE_ALT),
    ('BACKGROUND', (0, 4), (-1, 4), C_TABLE_ALT),
    ('BACKGROUND', (0, 6), (-1, 6), C_TABLE_ALT),
]))
story.append(cover_table)

story.append(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════
# TABLE OF CONTENTS (manual)
# ═══════════════════════════════════════════════════════════════════════════
story.append(Paragraph("Table des Matieres", style_title))
story.append(Spacer(1, 5*mm))

toc_items = [
    ("1", "Architecture et Structure du Repository"),
    ("2", "Audit des Endpoints API (12 fonctions serverless)"),
    ("3", "Audit de Securite — Auth, CORS, CSP, Rate Limiting"),
    ("4", "Audit du Moteur de Prediction (Poisson v2.0)"),
    ("5", "Audit du Pipeline de Verification (verify-predictions v22)"),
    ("6", "Audit du Systeme de Scraping et Auto-Playout"),
    ("7", "Audit Frontend — Pages, Composants, Hooks"),
    ("8", "Audit CI/CD — Workflows GitHub Actions"),
    ("9", "Audit Base de Donnees — Neon Postgres"),
    ("10", "Problemes Critiques et Plan d'Action Priorise"),
]

for num, title in toc_items:
    story.append(Paragraph(f'<b>{num}.</b>  {title}', ParagraphStyle(
        f'TOC_{num}', fontName='NotoSerifSC', fontSize=11, leading=16,
        textColor=C_TEXT, spaceAfter=2*mm, leftIndent=5*mm
    )))

story.append(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════
# SECTION 1 — ARCHITECTURE
# ═══════════════════════════════════════════════════════════════════════════
story.append(h1("1. Architecture et Structure du Repository"))

story.append(p(
    "VirtuMatch Predictor est une application de predictions sportives virtuelles construite sur un stack "
    "Vite 8 + React 18 + TypeScript. L'application est deployee sur Vercel (plan Hobby) avec une limite "
    "de 12 fonctions serverless et un timeout de 10 secondes par fonction. La base de donnees est Neon "
    "PostgreSQL (tier gratuit, 0.5 GB-heures/mois). L'APK Android est genere via Capacitor et publie "
    "automatiquement sur GitHub Releases a chaque push sur la branche main."
))

story.append(h2("1.1 Arborescence principale"))

story.append(make_table(
    ["Repertoire", "Contenu", "Fichiers cles"],
    [
        ["api/", "12 endpoints serverless Vercel", "auth.js, predictions.js, analyze-match.js, ..."],
        ["api/_lib/", "Modules partages (auth, db, cors)", "auth.js, db.js, cors.js"],
        ["api/_migrations/", "Migrations SQL (001-005)", "005_add_user_id_to_predictions.sql"],
        ["src/", "Frontend React + TypeScript", "pages/, components/, hooks/, lib/"],
        ["src/lib/", "Logique metier", "prediction-engine.ts, storage.ts, device.ts"],
        ["src/config/", "Configuration centralisee", "env.ts"],
        ["scripts/", "Scripts Python/Node utilitaires", "scraper-*.py, timing-*.mjs"],
        ["android/", "Projet Capacitor Android", "app/, gradlew, build.gradle"],
        [".github/workflows/", "CI/CD pipelines", "build-apk.yml, scrape-cron.yml"],
        ["docs/", "Documentation technique", "TODO-SECURITY.md, SECURITY-NEON.md"],
        ["sql/", "Scripts SQL de securite", "security-*.sql, fix_admin_login.sql"],
        ["legacy/", "Anciens fichiers Supabase", "supabase-pre-migration/"],
    ],
    col_widths=[30*mm, 60*mm, 80*mm]
))

story.append(h2("1.2 Stack technique"))

story.append(make_table(
    ["Composant", "Technologie", "Version / Detail"],
    [
        ["Build", "Vite", "8.2.1 (ESM, SWC plugin)"],
        ["UI", "React + TypeScript", "18.3.1 / 5.8.3"],
        ["Routing", "react-router-dom", "7.18.2"],
        ["UI Kit", "Radix UI + shadcn/ui", "~30 composants"],
        ["Styling", "Tailwind CSS", "3.4.17 + animate plugin"],
        ["Charts", "Recharts", "2.15.4"],
        ["PWA", "vite-plugin-pwa", "1.3.0 (Workbox)"],
        ["DB Client", "postgres.js", "3.4.9 (Neon)"],
        ["Email", "Resend", "6.20.0 (magic links)"],
        ["Mobile", "Capacitor", "8.2.0 (Android)"],
        ["Validation", "Zod + react-hook-form", "3.25.76 / 7.61.1"],
        ["Hosting", "Vercel Hobby", "12 fonctions max, 10s timeout"],
    ],
    col_widths=[30*mm, 50*mm, 90*mm]
))

story.append(h2("1.3 Flux de donnees principal"))

story.append(p(
    "Le flux de donnees suit un modele en 3 tiers : (1) le frontend React envoie des requetes aux API "
    "Routes Vercel, (2) les API Routes interrogent la base Neon PostgreSQL et/ou l'API externe "
    "sporty-tech.net, (3) les resultats sont renvoyes au frontend. Les predictions sont generees par "
    "le moteur Poisson cote client (prediction-engine.ts), enrichies optionnellement par l'IA Groq "
    "via l'endpoint analyze-match, puis sauvegardees via l'endpoint predictions."
))

story.append(p(
    "Le systeme de verification fonctionne en cron : auto-playout detecte les resultats playout, "
    "verify-predictions compare les predictions aux resultats officiels de l'API /results, et met a jour "
    "le statut (correct/incorrect) en base. Le systeme d'alertes precoces (early-alerts) detecte les "
    "resultats avant le debut officiel du match via le mecanisme playout-exploit."
))

story.append(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════
# SECTION 2 — API ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════
story.append(h1("2. Audit des Endpoints API (12 fonctions serverless)"))

story.append(p(
    "L'application utilise exactement 12 fonctions serverless Vercel, ce qui correspond a la limite "
    "du plan Hobby. Cette contrainte a necessite la fusion de plusieurs endpoints via le parametre "
    "?action= (par exemple, auth.js gere 3 actions : request, verify, latest-apk). Les 10 anciens "
    "endpoints morts ont ete supprimes lors d'un precedent audit."
))

story.append(make_table(
    ["Endpoint", "Methodes", "Actions / Roles", "Auth", "DB"],
    [
        ["auth.js", "GET, POST", "request, verify, latest-apk", "Rate limit + Resend", "magic_links, users"],
        ["predictions.js", "GET, POST, DELETE", "CRUD predictions", "User + Device HMAC", "predictions"],
        ["analyze-match.js", "POST", "IA Groq + fallback math", "User + Device HMAC", "Non"],
        ["admin-codes.js", "GET, POST", "login, verify, CRUD codes, migrate", "HMAC admin token", "access_codes, predictions"],
        ["fetch-live.js", "GET, POST", "Full, playout, quick-results", "CORS only", "Non (API proxy)"],
        ["verify-predictions.js", "GET, POST", "Cron + client verification", "CRON_SECRET / User / Device", "predictions"],
        ["auto-playout.js", "POST", "Cron playout exploit v5", "CRON_SECRET", "match_results, scheduled_fetches, early_alerts"],
        ["matches.js", "GET", "Proxy sporty-tech API", "CORS + leagueId validation", "Non (API proxy)"],
        ["push-odds.js", "POST", "Scraper push data", "SCRAPER_PUSH_KEY", "scraped_data"],
        ["premium-activate.js", "GET, POST", "Check + activate premium", "User + Device HMAC", "premium_activations, access_codes"],
        ["early-alerts.js", "GET", "Alertes precoces", "Public (+ admin pour ?all)", "early_alerts"],
        ["device-register.js", "POST", "HMAC secret issuance", "Rate limit 5/min", "device_secrets"],
    ],
    col_widths=[28*mm, 18*mm, 38*mm, 40*mm, 46*mm]
))

story.append(h2("2.1 Points d'attention"))

story.append(bullet(f"{status_badge('WARN')} <b>Limite 12 fonctions atteinte</b> : Aucun nouvel endpoint ne peut etre ajoute sans en supprimer un ou fusionner des actions supplementaires dans un endpoint existant."))
story.append(bullet(f"{status_badge('WARN')} <b>admin-codes.js : connexion DB module-level</b> : La connexion postgres est creee au niveau du module (ligne 21), pas dans le handler. En serverless, cela peut causer des fuites de connexion si l'instance est reutilisee. Les autres endpoints utilisent createSql() dans le handler."))
story.append(bullet(f"{status_badge('WARN')} <b>verify-predictions.js : API_URL en dur</b> : L'URL de l'API sporty-tech est hardcodee (ligne 17) au lieu d'utiliser SPORTY_API_BASE comme fetch-live.js et auto-playout.js."))
story.append(bullet(f"{status_badge('INFO')} <b>push-odds.js : JSON.stringify pour JSONB</b> : Le payload est stringify avant insertion (ligne 80), alors que postgres.js supporte les objets JS natifs. Fonctionne mais sous-optimal."))
story.append(bullet(f"{status_badge('OK')} <b>Rate limiting</b> : Present sur auth.js, predictions.js, admin-codes.js, premium-activate.js, device-register.js + middleware Edge global (30/min/IP)."))

story.append(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════
# SECTION 3 — SECURITY AUDIT
# ═══════════════════════════════════════════════════════════════════════════
story.append(h1("3. Audit de Securite"))

story.append(h2("3.1 Authentification"))

story.append(p(
    "Le systeme d'authentification est dual : (1) <b>Device HMAC</b> (requireAuth) — le client genere "
    "un token HMAC-SHA256 a partir d'un secret emis par le serveur lors de l'enregistrement de l'appareil. "
    "Le token expire apres 7 jours. (2) <b>User Session</b> (requireUserAuth) — magic link envoye par "
    "email via Resend, token HMAC-SHA256 avec userId embarque, expire apres 30 jours. La priorite est "
    "toujours User Auth (Bearer) > Device Auth (Device header)."
))

story.append(make_table(
    ["Propriete", "Device HMAC", "User Session (Magic Link)"],
    [
        ["Format token", "base64url(ts).base64url(hmac)", "base64url(ts).base64url(userId).base64url(hmac)"],
        ["Secret", "Per-device (32 bytes random)", "USER_SESSION_SECRET (env var)"],
        ["Expiration", "7 jours", "30 jours"],
        ["Comparaison", "crypto.timingSafeEqual", "crypto.timingSafeEqual"],
        ["Enregistrement", "POST /api/device-register", "POST /api/auth?action=request"],
        ["Fallback legacy", "x-device-id header + body.device_id", "Aucun"],
        ["Utilise par", "predictions, premium-activate, verify", "predictions, premium-activate, verify"],
    ],
    col_widths=[30*mm, 70*mm, 70*mm]
))

story.append(h2("3.2 Problemes de securite identifies"))

story.append(bullet(f"{status_badge('CRIT')} <b>Fallback device_id en clair</b> : requireAuth() accepte encore un device_id en clair via x-device-id, body.device_id, et query.device_id (lignes 199-222 de auth.js). Un attaquant peut forger n'importe quel device_id. Les logs indiquent 'FALLBACK' mais l'acces est accorde. TODO : supprimer apres migration complete des clients."))
story.append(bullet(f"{status_badge('WARN')} <b>USER_SESSION_SECRET non documente</b> : Si cette variable d'environnement n'est pas configuree, signUserToken() leve une exception mais verifyUserToken() echoue silencieusement (retourne null). Aucune alerte au demarrage."))
story.append(bullet(f"{status_badge('WARN')} <b>Magic link non revoke</b> : Les tokens magic_links sont marques 'used' mais jamais supprimes. Apres usage, le hash reste en base indefinitely. Pas de mecanisme de revocation en cas de compromission."))
story.append(bullet(f"{status_badge('WARN')} <b>early-alerts ?all=true : verification token inline</b> : La verification du token admin est dupliquee inline (lignes 56-83) au lieu d'utiliser verifyToken() de admin-codes.js. Risque de divergence si le schema de token change."))
story.append(bullet(f"{status_badge('INFO')} <b>CORS Capacitor header</b> : Le header x-capacitor-request bypass completement la validation d'origine. Un attaquant peut ajouter ce header pour contourner CORS."))

story.append(h2("3.3 CSP (Content Security Policy)"))

story.append(p(
    "La CSP est definie dans vercel.json et appliquee globalement : default-src 'self'; "
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' "
    "https://cdn.jsdelivr.net; img-src 'self' data: blob: https://lh3.googleusercontent.com; "
    "font-src 'self'; connect-src 'self' https://*.vercel.app; frame-ancestors 'none'."
))

story.append(bullet(f"{status_badge('WARN')} <b>'unsafe-inline' dans script-src et style-src</b> : Necessaire pour le fonctionnement actuel, mais reduit la protection XSS. Vite 8 genere des hashes CSP utilisables si 'unsafe-inline' est supprime."))
story.append(bullet(f"{status_badge('OK')} <b>connect-src correct</b> : Seuls 'self' et https://*.vercel.app sont autorises. Les appels externes (GitHub API, sporty-tech) passent par des proxies server-side."))
story.append(bullet(f"{status_badge('OK')} <b>frame-ancestors 'none'</b> : Protege contre le clickjacking."))

story.append(h2("3.4 Rate Limiting"))

story.append(p(
    "Le rate limiting est implemente a 2 niveaux : (1) middleware Edge global (30 requetes/min/IP pour "
    "toutes les routes API), (2) rate limiting specifique par endpoint (auth : 3/15min par email et IP, "
    "admin login : 5/15min par IP, predictions : 30/min par IP, premium : 15/heure par identifiant, "
    "device-register : 5/min par IP). Toutes les implementations sont en memoire (Map), ce qui signifie "
    "qu'elles se resetent a chaque cold start et ne sont pas partagees entre instances paralleles."
))

story.append(bullet(f"{status_badge('WARN')} <b>Rate limiting in-memory</b> : Inefficace contre les attaques distribuees ou multi-region. La migration vers Upstash Redis est recommandee (code de migration deja present en commentaire dans middleware.js)."))

story.append(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════
# SECTION 4 — PREDICTION ENGINE
# ═══════════════════════════════════════════════════════════════════════════
story.append(h1("4. Audit du Moteur de Prediction (Poisson v2.0)"))

story.append(p(
    "Le moteur de prediction est implemente dans src/lib/prediction-engine.ts et s'execute entierement "
    "cote client (dans le navigateur ou l'APK). Il est complete par un appel optionnel a l'IA Groq via "
    "l'endpoint analyze-match. Le moteur suit un pipeline en 7 etapes : conversion des cotes en probabilites, "
    "estimation des lambdas Poisson par grid search, calcul de la distribution des scores, analyse "
    "multicritere (forme, H2H, classement), detection anti-trap (5 alertes), generation du score virtuel, "
    "et calcul des marches derives (BTTS, Over/Under)."
))

story.append(h2("4.1 Algorithmes cles"))

story.append(make_table(
    ["Etape", "Algorithme", "Entree", "Sortie"],
    [
        ["1. Cotes -> Probabilites", "Inverse cotes + normalisation", "oddHome, oddDraw, oddAway", "pH, pD, pA, favorite"],
        ["2. Lambdas Poisson", "Grid Search (0.5-3.0, pas 0.1)", "pH, pD, pA cibles", "lambdaH, lambdaA"],
        ["3. Distribution scores", "Poisson(lambda, k) x Poisson(lambda, k)", "lambdaH, lambdaA", "Matrice 11x11 de probabilites"],
        ["4. Ajustement forme", "Poids: recent 1.5 -> ancien 1.0", "form[] (V/N/D)", "Facteur ajustement"],
        ["5. Anti-trap", "5 alertes (momentum, attaque, H2H, classement, cotes)", "Stats + cotes + H2H", "dangerLevel, isAntiTrap"],
        ["6. Score virtuel", "Distribution typique virtuelle", "Probabilites ajustees", "predictedHome, predictedAway"],
        ["7. Marches derives", "BTTS, O/U 1.5/2.5/3.5, parite", "Distribution scores", "bttsProb, over25Prob, etc."],
    ],
    col_widths=[30*mm, 40*mm, 40*mm, 60*mm]
))

story.append(h2("4.2 Problemes identifies"))

story.append(bullet(f"{status_badge('WARN')} <b>Pas de walk-forward validation</b> : Le moteur utilise les statistiques actuelles sans validation historique. Il n'existe aucun framework de backtesting pour mesurer la precision reelle du modele sur des donnees passees."))
story.append(bullet(f"{status_badge('WARN')} <b>Grid Search discret</b> : La recherche des lambdas se fait par pas de 0.1 entre 0.5 et 3.0, soit 26x26 = 676 combinaisons. Un optimiseur continu (Newton-Raphson ou descente de gradient) serait plus precis et plus rapide."))
story.append(bullet(f"{status_badge('WARN')} <b>Pas de calibration</b> : Les probabilites generees ne sont pas calibrees. Si le moteur dit P(home) = 60%, il n'y a aucune garantie que 60% des matchs similaires se terminent par une victoire domicile. Un calibration de Platt ou des bins isotones seraient necessaires."))
story.append(bullet(f"{status_badge('INFO')} <b>Factorial cache limite</b> : Le cache de factorielle est pre-rempli jusqu'a 7! (5040). Au-dela, il est calcule dynamiquement. Pour des lambdas <= 3.0, k ne depasse jamais 10, donc le cache est suffisant."))
story.append(bullet(f"{status_badge('INFO')} <b>Distribution virtuelle hardcodee</b> : Les probabilites de scores virtuels (0-0: 18%, 1-0: 15%, etc.) sont codees en dur dans le system prompt Groq et dans le moteur math. Elles ne sont pas apprises from les donnees reelles."))

story.append(h2("4.3 IA Groq (analyze-match.js)"))

story.append(p(
    "L'endpoint analyze-match.js utilise l'API Groq avec le modele llama-3.3-70b-versatile pour generer "
    "des predictions AI. Le system prompt (v7.0) est optimise pour le football virtuel avec des regles "
    "specifiques (scores bas, nul ~30%, avantage domicile ~5%). L'IA produit un JSON structure avec score, "
    "confidence, raisonnement, detection anti-trap, et marches derives. En cas d'echec IA (timeout, erreur), "
    "le moteur mathematique cote client est utilise comme fallback."
))

story.append(bullet(f"{status_badge('WARN')} <b>Timeout 10s Vercel vs Groq</b> : L'endpoint analyze-match peut timeout avant que Groq reponde (surtout avec plusieurs matchs en batch). Le frontend gere ce cas via un fallback math, mais l'experience utilisateur est degradee."))
story.append(bullet(f"{status_badge('INFO')} <b>GROQ_API_KEY masquage partiel</b> : La cle est logguee avec masquage (6 premiers + 4 derniers chars) pour le debug, mais ne fuite jamais vers le client."))

story.append(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════
# SECTION 5 — VERIFICATION PIPELINE
# ═══════════════════════════════════════════════════════════════════════════
story.append(h1("5. Audit du Pipeline de Verification (verify-predictions v22)"))

story.append(p(
    "Le pipeline de verification est la piece maitresse du systeme : il compare les predictions en attente "
    "(status='pending') aux resultats officiels des matchs pour determiner si elles sont correctes ou "
    "incorrectes. La version 22 utilise une strategie 'API-first' : l'API /results de sporty-tech.net "
    "est la source de verite, la base de donnees (match_results du playout) n'est utilisee qu'en fallback. "
    "Le pipeline peut etre invoque par le cron (CRON_SECRET) pour une verification complete, ou par un "
    "client (user/device auth) pour verifier uniquement ses propres predictions."
))

story.append(h2("5.1 Processus de verification"))

story.append(bullet("<b>Etape 1</b> : Fetch /matches pour chaque league -> construire l'ensemble des match IDs actifs"))
story.append(bullet("<b>Etape 2</b> : Si prediction.match_id n'est pas dans l'ensemble actif -> le match est termine"))
story.append(bullet("<b>Etape 3</b> : Fetch /results API pour la league -> chercher par round + team names"))
story.append(bullet("<b>Etape 4</b> : Matching par 3 strategies : exact -> normalise (NFKD + accents) -> partiel (contains)"))
story.append(bullet("<b>Etape 5</b> : Mettre a jour le statut (correct/incorrect) + score reel + verified_at"))

story.append(h2("5.2 Problemes identifies"))

story.append(bullet(f"{status_badge('WARN')} <b>Matching partiel risque</b> : La strategie 'partial match' (contains) peut matcher incorrectement des equipes avec des noms similaires (ex: 'City' peut matcher 'Man City' et 'Leicester City'). Le risque est faible en football virtuel (noms courts uniques) mais existe."))
story.append(bullet(f"{status_badge('WARN')} <b>Pas de cache entre invocations</b> : Les resultats /results API sont fetch a chaque invocation. Un cache (meme in-memory avec TTL de 5 minutes) eviterait des appels redondants quand le cron tourne frequemment."))
story.append(bullet(f"{status_badge('INFO')} <b>Limite 200 predictions</b> : Seules les 200 premieres predictions pending sont verifiees par invocation. En cas de pic, certaines predictions restent non verifiees jusqu'a l'invocation suivante."))

story.append(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════
# SECTION 6 — SCRAPING & AUTO-PLAYOUT
# ═══════════════════════════════════════════════════════════════════════════
story.append(h1("6. Audit du Systeme de Scraping et Auto-Playout"))

story.append(h2("6.1 Auto-playout v5 (playout exploit)"))

story.append(p(
    "L'endpoint auto-playout.js est le cron le plus complexe du systeme. Il detecte les resultats des "
    "matchs virtuels via le endpoint /playout de l'API sporty-tech, qui expose les scores avant meme "
    "que le match ne commence officiellement. Le systeme utilise 5 phases de fetch (offsets : +5s, +15s, "
    "+30s, +60s, +120s par rapport a expectedStart), plus un hot-poll agressif (5s d'intervalle, 8 "
    "iterations) dans la zone critique (10s avant a 120s apres expectedStart). Les resultats sont "
    "stockes dans match_results et les alertes precoces dans early_alerts."
))

story.append(bullet(f"{status_badge('OK')} <b>waitUntil pour background</b> : Le handler repond 202 immediatement, le travail lourd s'execute via res.unstable_waitUntil(). Prevent les timeouts cron."))
story.append(bullet(f"{status_badge('OK')} <b>CRON_SECRET obligatoire</b> : Meme en mode ?manual=true, la cle CRON est requise. Aucun bypass possible."))
story.append(bullet(f"{status_badge('WARN')} <b>CREATE TABLE IF NOT EXISTS dans le handler</b> : ensureTables() cree les tables a chaque invocation. C'est un anti-pattern en production (schema drift, DDL locks). Les tables devraient etre creees via les migrations SQL."))
story.append(bullet(f"{status_badge('WARN')} <b>Goals JSONB stringifie</b> : Les goals sont inseres avec JSON.stringify() (ligne 324) au lieu de passer l'objet JS directement. Fonctionne mais sous-optimal avec postgres.js."))

story.append(h2("6.2 Scraper Python"))

story.append(p(
    "Les scripts Python (scraper-all-leagues.py, scraper-api.py, scraper-local.py, scraper-live.py) "
    "sont executes via GitHub Actions (cron toutes les 2 heures) ou manuellement. Ils interrogent "
    "l'API sporty-tech et poussent les donnees via POST /api/push-odds avec le header x-push-key. "
    "Les scripts dependent de variables d'environnement (SPORTY_API_BASE, API_ORIGIN, API_REFERER, "
    "API_APP_VERSION, PUSH_URL, SCRAPER_PUSH_KEY) qui doivent etre configurees comme GitHub Secrets."
))

story.append(bullet(f"{status_badge('WARN')} <b>Secrets GitHub manquants</b> : Les secrets SPORTY_API_BASE, API_ORIGIN, API_REFERER, API_APP_VERSION, PUSH_URL, SCRAPER_PUSH_KEY ne sont pas confirmes comme configures. Le scraper echouera silencieusement si manquants."))

story.append(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════
# SECTION 7 — FRONTEND
# ═══════════════════════════════════════════════════════════════════════════
story.append(h1("7. Audit Frontend"))

story.append(h2("7.1 Pages"))

story.append(make_table(
    ["Page", "Route", "Composant principal", "API calls"],
    [
        ["Index", "/", "MatchForm + ResultCard", "analyze-match, auth?action=latest-apk"],
        ["LiveMatches", "/live", "LeagueData", "fetch-live, matches"],
        ["History", "/history", "usePredictions hook", "predictions (GET), verify-predictions"],
        ["Admin", "/admin", "Admin codes management", "admin-codes (login, CRUD)"],
        ["SettingsPage", "/settings", "Premium + auth settings", "premium-activate, auth"],
        ["Shop", "/shop", "PremiumGate", "premium-activate"],
        ["Guide", "/guide", "Static content", "Aucun"],
        ["AuthVerify", "/auth/verify", "Magic link verifier", "auth?action=verify"],
    ],
    col_widths=[25*mm, 20*mm, 45*mm, 80*mm]
))

story.append(h2("7.2 Hooks personnalises"))

story.append(make_table(
    ["Hook", "Usage", "API dependency"],
    [
        ["use-predictions", "CRUD predictions + verification", "predictions, verify-predictions"],
        ["use-live-matches", "Fetch + poll matchs en direct", "fetch-live"],
        ["use-early-alerts", "Alertes precoces", "early-alerts"],
        ["use-league-teams", "Equipes et classement", "matches"],
        ["use-admin-device-ids", "Admin migration", "admin-codes?action=migrate"],
        ["use-mobile", "Detection mobile Capacitor", "Aucun"],
        ["use-toast", "Notifications toast", "Aucun"],
    ],
    col_widths=[35*mm, 55*mm, 80*mm]
))

story.append(h2("7.3 Problemes identifies"))

story.append(bullet(f"{status_badge('WARN')} <b>PWA workbox caching Neon</b> : Le cache workbox cacle les requetes vers *.neon.tech (NetworkFirst, 24h). C'est contre-productif car les donnees de matchs changent toutes les minutes. Le cache devrait etre limite aux assets statiques uniquement."))
story.append(bullet(f"{status_badge('INFO')} <b>Composants UI non utilises</b> : ~30 composants shadcn/ui sont installes mais potentiellement non utilises (calendar, resizable, menubar, etc.). Augmente le bundle size inutilement."))
story.append(bullet(f"{status_badge('INFO')} <b>console.log supprimes en prod</b> : La config Vite supprime console.log et console.info en production (oxc.drop), mais conserve console.warn et console.error. Configuration correcte."))

story.append(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════
# SECTION 8 — CI/CD
# ═══════════════════════════════════════════════════════════════════════════
story.append(h1("8. Audit CI/CD"))

story.append(make_table(
    ["Workflow", "Declencheur", "Actions", "Secrets requis"],
    [
        ["build-apk.yml", "push main + manual", "Build + APK + Release", "VITE_API_BASE, KEYSTORE_BASE64, KEYSTORE_PASSWORD, GITHUB_TOKEN"],
        ["scrape-cron.yml", "cron 0 */2 * * * + manual", "Python scraper all leagues", "SPORTY_API_BASE, API_ORIGIN, API_REFERER, API_APP_VERSION, PUSH_URL, SCRAPER_PUSH_KEY"],
        ["branch-guard.yml", "push main", "Security audit (secrets, CORS)", "Aucun"],
    ],
    col_widths=[28*mm, 28*mm, 50*mm, 64*mm]
))

story.append(h2("8.1 Problemes identifies"))

story.append(bullet(f"{status_badge('OK')} <b>APK publie en GitHub Release</b> : L'APK est publie comme Release permanente (tag apk-latest) via softprops/action-gh-release@v2, ce qui resout le probleme d'expiration des artifacts (7 jours)."))
story.append(bullet(f"{status_badge('OK')} <b>Branch guard</b> : Le workflow branch-guard.yml detecte les URLs API, les cles hardcodees, et les fichiers .env commits. Il ne bloque pas le push mais alerte."))
story.append(bullet(f"{status_badge('WARN')} <b>Pas de tests automatises dans CI</b> : Aucun workflow ne lance les tests (vitest). Les tests existent (src/test/) mais ne sont pas executes dans le pipeline CI/CD."))
story.append(bullet(f"{status_badge('WARN')} <b>Keystore en base64 secret</b> : Le keystore Android est decode depuis un secret base64. Fonctionne mais sensible : si KEYSTORE_BASE64 fuite, n'importe qui peut signer des APK."))
story.append(bullet(f"{status_badge('INFO')} <b>Pas de preview deployments</b> : Seul le push sur main deploie. Les PRs ne generent pas de preview Vercel (branch deployments non configures)."))

story.append(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════
# SECTION 9 — DATABASE
# ═══════════════════════════════════════════════════════════════════════════
story.append(h1("9. Audit Base de Donnees (Neon Postgres)"))

story.append(h2("9.1 Schema principal"))

story.append(make_table(
    ["Table", "Colonnes cles", "Utilisation", "Indexes"],
    [
        ["predictions", "id, home_team, away_team, prediction, confidence, status, device_id, user_id, ...", "CRUD predictions + verification", "idx_predictions_user_id, idx_predictions_user_status"],
        ["users", "id, email", "Magic link auth", "UNIQUE(email)"],
        ["device_secrets", "device_id, device_secret, created_at", "HMAC auth", "UNIQUE(device_id), PK(device_id)"],
        ["magic_links", "id, token_hash, email, purpose, payload, expires_at, used_at", "Email auth flow", "Sur token_hash"],
        ["access_codes", "id, code, duration_days, used, used_by_device", "Premium activation", "UNIQUE(code)"],
        ["premium_activations", "device_id, user_id, activated_at, expires_at", "Premium status", "Sur device_id et user_id"],
        ["match_results", "id, league_id, round_number, match_id, score_home, score_away, ...", "Playout results", "idx_match_results_round, UNIQUE(league_id, round_number, match_id)"],
        ["scheduled_fetches", "id, league_id, round_number, fetch_phase, fetch_after, fetched", "Cron scheduling", "idx_scheduled_fetches_pending"],
        ["early_alerts", "id, league_id, match_id, score_home, score_away, how_early_seconds", "Pre-start alerts", "idx_early_alerts_active, UNIQUE(league_id, round_number, match_id)"],
        ["scraped_data", "id, data_type, league, payload, scraped_at", "Scraper cache", "Sur data_type + league"],
    ],
    col_widths=[28*mm, 50*mm, 35*mm, 57*mm]
))

story.append(h2("9.2 Migrations"))

story.append(make_table(
    ["ID", "Description", "Statut"],
    [
        ["001", "device_secrets (HMAC device auth)", "Appliquee"],
        ["002", "user_accounts (magic link users)", "Appliquee"],
        ["003", "add_migrate_purpose (migrate flow)", "Appliquee"],
        ["004", "make_device_id_nullable (user_id migration)", "Appliquee"],
        ["005", "add_user_id_to_predictions + indexes", "<b>A APPLIQUER</b>"],
    ],
    col_widths=[15*mm, 100*mm, 55*mm]
))

story.append(h2("9.3 Problemes identifies"))

story.append(bullet(f"{status_badge('CRIT')} <b>Migration 005 non appliquee</b> : ALTER TABLE predictions ADD COLUMN user_id TEXT + indexes n'a pas ete executee sur Neon. Sans cette colonne, le user_id est toujours NULL dans les predictions, et la requete WHERE user_id = xxx renvoie 0 resultats. L'historique est casse pour les utilisateurs magic link."))
story.append(bullet(f"{status_badge('WARN')} <b>Connection string non-pooled</b> : createSql() utilise NEON_DATABASE_URL directement. Neon recommande d'utiliser la connection string pooled (-pooler suffix) pour le serverless afin de ne pas epuiser les connexions. Sur le tier gratuit (0.5 GB-h/mois), chaque connexion non-pooled consomme plus de compute."))
story.append(bullet(f"{status_badge('WARN')} <b>sql.end() manquant dans certains cas</b> : Dans admin-codes.js, la connexion sql est module-level et n'est jamais fermee explicitement. Les autres endpoints ferment la connexion dans chaque handler."))
story.append(bullet(f"{status_badge('WARN')} <b>CREATE TABLE IF NOT EXISTS dans auto-playout</b> : Le handler cree les tables a chaque invocation (ensureTables). Risque de schema drift et de conflits DDL en production."))
story.append(bullet(f"{status_badge('INFO')} <b>Poisoned predictions reset</b> : auto-playout nettoie les predictions 'incorrect' avec actual_score='0:0' (faux resultats du playout avant le debut du match). Bonne pratique defensive."))

story.append(PageBreak())

# ═══════════════════════════════════════════════════════════════════════════
# SECTION 10 — ACTION PLAN
# ═══════════════════════════════════════════════════════════════════════════
story.append(h1("10. Problemes Critiques et Plan d'Action Priorise"))

story.append(h2("10.1 Critique (a resoudre immediatement)"))

story.append(make_table(
    ["#", "Probleme", "Impact", "Action"],
    [
        ["C1", "Migration 005 non appliquee", "Historique casse pour magic link users", "Executer ALTER TABLE + CREATE INDEX sur Neon"],
        ["C2", "Fallback device_id en clair", "N'importe qui peut forger un device_id", "Supprimer le fallback apres migration clients"],
    ],
    col_widths=[10*mm, 50*mm, 50*mm, 60*mm]
))

story.append(h2("10.2 Avertissement (a resoudre sous 1-2 semaines)"))

story.append(make_table(
    ["#", "Probleme", "Impact", "Action"],
    [
        ["W1", "Rate limiting in-memory", "Inefficace multi-region", "Migrer vers Upstash Redis"],
        ["W2", "admin-codes.js : connexion module-level", "Fuite de connexion serverless", "Deplacer createSql() dans le handler"],
        ["W3", "verify-predictions : API URL hardcodee", "Inconsistance config", "Utiliser SPORTY_API_BASE env var"],
        ["W4", "Pas de backtesting", "Precision du modele inconnue", "Implementer walk-forward validation"],
        ["W5", "Pas de calibration", "Probabilites non calibrees", "Implementer Platt scaling / isotonic regression"],
        ["W6", "Secrets GitHub scraper manquants", "Scraper echoue silencieusement", "Configurer les 6 secrets dans GitHub"],
        ["W7", "PWA cache Neon API", "Donnees stale en cache", "Retirer *.neon.tech du workbox runtimeCaching"],
        ["W8", "CREATE TABLE dans auto-playout", "Schema drift / DDL locks", "Deplacer vers migrations SQL"],
        ["W9", "Connection string non-pooled", "Compute Neon gaspille", "Utiliser la connection string -pooler"],
        ["W10", "Tests non executes en CI", "Regressions non detectees", "Ajouter vitest au workflow build-apk"],
    ],
    col_widths=[10*mm, 50*mm, 45*mm, 65*mm]
))

story.append(h2("10.3 Ameliorations (backlog)"))

story.append(make_table(
    ["#", "Amelioration", "Benefice"],
    [
        ["I1", "Optimiseur continu pour lambdas Poisson", "Precision + rapidite du moteur"],
        ["I2", "Cache API results dans verify-predictions", "Reduit appels API redondants"],
        ["I3", "Supprimer composants shadcn inutilises", "Bundle size reduit"],
        ["I4", "Preview deployments sur PR", "Review visuelle avant merge"],
        ["I5", "Deduplication token admin dans early-alerts", "Maintenabilite du code"],
        ["I6", "Model versioning pour le moteur de prediction", "A/B testing des modeles"],
        ["I7", "Observabilite (logs structures, metriques)", "Debugging production"],
        ["I8", "CSP hashes au lieu de unsafe-inline", "Protection XSS renforcee"],
    ],
    col_widths=[10*mm, 80*mm, 80*mm]
))

story.append(Spacer(1, 10*mm))
story.append(hr())
story.append(Spacer(1, 5*mm))
story.append(Paragraph(
    "Rapport genere automatiquement par Z.ai — Audit technique VirtuMatch Predictor",
    ParagraphStyle('Final', fontName='NotoSerifSC', fontSize=8, leading=10,
                   textColor=C_TEXT_LIGHT, alignment=TA_CENTER)
))

# ─── Build ──────────────────────────────────────────────────────────────────
doc.build(story, onFirstPage=add_page_number, onLaterPages=add_page_number)
print(f"PDF genere avec succes : {OUTPUT}")
