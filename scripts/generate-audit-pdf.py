#!/usr/bin/env python3
"""
Rapport d'Audit Complet - VirtuMatch Predictor
Phase 1 : Audit lecture seule (sans modification de fichiers)
"""

import os
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm, cm
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, ListFlowable, ListItem, KeepTogether, HRFlowable,
    Flowable
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# FONTS
FONT_DIR = '/usr/share/fonts/truetype'
CJK_FONT_DIR = os.path.join(FONT_DIR, 'chinese')
NOTO_SANS = os.path.join(CJK_FONT_DIR, 'NotoSansSC[wght].ttf')
SARASA = os.path.join(CJK_FONT_DIR, 'SarasaMonoSC-Regular.ttf')
NOTO_SERIF = os.path.join(FONT_DIR, 'noto-serif-sc', 'NotoSerifSC-Regular.ttf')

# Register CJK font - try NotoSansSC variable first, then Sarasa fallback
try:
    pdfmetrics.registerFont(TTFont('NotoSansSC', NOTO_SANS))
except Exception:
    try:
        pdfmetrics.registerFont(TTFont('NotoSansSC', SARASA))
    except Exception:
        pdfmetrics.registerFont(TTFont('NotoSansSC', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'))

try:
    pdfmetrics.registerFont(TTFont('NotoSerifSC', NOTO_SERIF))
except Exception:
    pdfmetrics.registerFont(TTFont('NotoSerifSC', NOTO_SANS))

# PALETTE
PAGE_BG = colors.HexColor('#0b0a0a')
CARD_BG = colors.HexColor('#1d1c17')
TABLE_STRIPE = colors.HexColor('#201e1a')
HEADER_FILL = colors.HexColor('#544d37')
BORDER = colors.HexColor('#5a5136')
ICON = colors.HexColor('#c3b488')
ACCENT = colors.HexColor('#d4b65b')
ACCENT_2 = colors.HexColor('#70bdd7')
TEXT_PRIMARY = colors.HexColor('#e8e7e6')
TEXT_MUTED = colors.HexColor('#9c9a94')
SEM_SUCCESS = colors.HexColor('#81b893')
SEM_WARNING = colors.HexColor('#c5a86d')
SEM_ERROR = colors.HexColor('#b2706a')
SEM_INFO = colors.HexColor('#6b94bd')

# STYLES
base_styles = getSampleStyleSheet()
s = {}
s['title'] = ParagraphStyle('title', parent=base_styles['Title'], fontName='NotoSansSC', fontSize=28, leading=34, textColor=ACCENT, alignment=TA_LEFT, spaceAfter=6)
s['subtitle'] = ParagraphStyle('subtitle', parent=base_styles['Normal'], fontName='NotoSansSC', fontSize=14, leading=18, textColor=TEXT_MUTED, alignment=TA_LEFT, spaceAfter=12)
s['h1'] = ParagraphStyle('h1', parent=base_styles['Heading1'], fontName='NotoSansSC', fontSize=18, leading=22, textColor=ACCENT, spaceBefore=18, spaceAfter=10)
s['h2'] = ParagraphStyle('h2', parent=base_styles['Heading2'], fontName='NotoSansSC', fontSize=14, leading=18, textColor=ACCENT_2, spaceBefore=14, spaceAfter=8)
s['h3'] = ParagraphStyle('h3', parent=base_styles['Heading3'], fontName='NotoSansSC', fontSize=12, leading=15, textColor=ICON, spaceBefore=10, spaceAfter=6)
s['body'] = ParagraphStyle('body', parent=base_styles['Normal'], fontName='NotoSansSC', fontSize=10, leading=14, textColor=TEXT_PRIMARY, alignment=TA_JUSTIFY, spaceBefore=3, spaceAfter=6)
s['bi'] = ParagraphStyle('bi', parent=s['body'], leftIndent=20)
s['code'] = ParagraphStyle('code', parent=base_styles['Code'], fontName='NotoSansSC', fontSize=9, leading=12, textColor=ACCENT_2, backColor=CARD_BG, leftIndent=12, rightIndent=12, spaceBefore=4, spaceAfter=4, borderWidth=0.5, borderColor=BORDER, borderPadding=6)
s['th'] = ParagraphStyle('th', parent=base_styles['Normal'], fontName='NotoSansSC', fontSize=9, leading=12, textColor=colors.white, alignment=TA_CENTER)
s['tc'] = ParagraphStyle('tc', parent=base_styles['Normal'], fontName='NotoSansSC', fontSize=9, leading=12, textColor=TEXT_PRIMARY, alignment=TA_LEFT)
s['ft'] = ParagraphStyle('ft', parent=base_styles['Normal'], fontName='NotoSansSC', fontSize=11, leading=14, textColor=SEM_ERROR, spaceBefore=8, spaceAfter=4)
s['toc'] = ParagraphStyle('toc', parent=s['body'], fontSize=10)
s['tocsub'] = ParagraphStyle('tocsub', parent=s['body'], leftIndent=20, fontSize=9)


def make_table(headers, rows, col_widths=None):
    aw = 460
    if col_widths is None:
        n = len(headers)
        col_widths = [aw / n] * n
    header_cells = [Paragraph(h, s['th']) for h in headers]
    data = [header_cells]
    for row in rows:
        data.append([Paragraph(str(c), s['tc']) for c in row])
    t = Table(data, colWidths=col_widths, repeatRows=1)
    cmds = [
        ('BACKGROUND', (0, 0), (-1, 0), HEADER_FILL),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'NotoSansSC'),
        ('FONTSIZE', (0, 0), (-1, 0), 9),
        ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ]
    for i in range(1, len(data)):
        if i % 2 == 0:
            cmds.append(('BACKGROUND', (0, i), (-1, i), TABLE_STRIPE))
    t.setStyle(TableStyle(cmds))
    return t


def code_block(text):
    safe = text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('\n', '<br/>')
    return Paragraph(safe, s['code'])


def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(BORDER)
    canvas.setLineWidth(0.3)
    canvas.line(40, A4[1] - 35, A4[0] - 40, A4[1] - 35)
    canvas.setFont('NotoSansSC', 7)
    canvas.setFillColor(TEXT_MUTED)
    canvas.drawString(40, A4[1] - 30, 'AUDIT VIRTUMATCH PREDICTOR | CONFIDENTIEL')
    canvas.drawRightString(A4[0] - 40, A4[1] - 30, '2026-09-09')
    canvas.line(40, 30, A4[0] - 40, 30)
    canvas.drawString(40, 18, 'Phase 1 - Lecture seule')
    canvas.drawRightString(A4[0] - 40, 18, f'Page {doc.page}')
    canvas.restoreState()


# BUILD
OUTPUT_DIR = '/home/z/my-project/download'
os.makedirs(OUTPUT_DIR, exist_ok=True)
OUTPUT_PATH = os.path.join(OUTPUT_DIR, 'audit-virtumatch-predictor.pdf')

doc = SimpleDocTemplate(OUTPUT_PATH, pagesize=A4, leftMargin=40, rightMargin=40, topMargin=45, bottomMargin=45,
    title='Audit de Securite - VirtuMatch Predictor', author='Z.ai Security Audit',
    subject='Phase 1 - Audit lecture seule du repository VirtuMatch Predictor')

story = []

# COVER
story.append(Spacer(1, 60))
story.append(Paragraph('AUDIT DE SECURITE', ParagraphStyle('ct', parent=s['title'], fontSize=32, leading=38, textColor=ACCENT)))
story.append(Spacer(1, 8))
story.append(Paragraph('VirtuMatch Predictor', ParagraphStyle('ca', parent=s['title'], fontSize=24, leading=30, textColor=TEXT_PRIMARY)))
story.append(Spacer(1, 6))
story.append(Paragraph('Phase 1 - Audit lecture seule (sans modification de fichiers)', s['subtitle']))
story.append(Spacer(1, 20))

meta_data = [
    ['Repository', 'github.com/HITIFok/remix-of-virtumatch-predictor-86'],
    ['Date d\'audit', '2026-09-09'],
    ['Auditeur', 'Z.ai - Security Audit Engine'],
    ['Phase', '1 (Lecture seule)'],
    ['Score global', 'CRITIQUE - 3 vulnerabilites critiques'],
]
mt = Table(meta_data, colWidths=[120, 340])
mt.setStyle(TableStyle([
    ('FONTNAME', (0, 0), (-1, -1), 'NotoSansSC'), ('FONTSIZE', (0, 0), (-1, -1), 9),
    ('TEXTCOLOR', (0, 0), (0, -1), ACCENT), ('TEXTCOLOR', (1, 0), (1, -1), TEXT_PRIMARY),
    ('BACKGROUND', (0, 0), (0, -1), CARD_BG), ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
    ('TOPPADDING', (0, 0), (-1, -1), 5), ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ('LEFTPADDING', (0, 0), (-1, -1), 8),
]))
story.append(mt)
story.append(Spacer(1, 30))
story.append(HRFlowable(width='100%', thickness=1, color=ACCENT))
story.append(Spacer(1, 15))

story.append(Paragraph('RESUME EXECUTIF', s['h2']))
story.append(Paragraph(
    'Cet audit a identifie <b>3 vulnerabilites critiques</b> (V-01, V-02, V-03) dans le repository VirtuMatch Predictor. '
    'Ces vulnerabilites permettent respectivement l\'usurpation d\'identite de device, le contournement CORS par header spoofing, '
    'et l\'execution de JavaScript injecte en cas de XSS. En complement, <b>17 coefficients arbitraires</b> non valides empiriquement '
    'ont ete identifies dans le moteur predictif, avec une couverture de tests pratiquement nulle (un seul test placeholder). '
    'Le rapport detaille les flux d\'attaque, les fichiers concernes et les plans de correction pour chaque vulnerabilite, '
    'suivi d\'une analyse complete du moteur predictif et des phases de remediation ordonnees.', s['body']))

story.append(PageBreak())

# TABLE OF CONTENTS
story.append(Paragraph('TABLE DES MATIERES', s['h1']))
story.append(Spacer(1, 8))
toc_items = [
    ('1', 'Vulnerabilites critiques identifiees', False),
    ('1.1', 'V-01 : Usurpation d\'identite par x-device-id sans HMAC', True),
    ('1.2', 'V-02 : Contournement CORS par x-capacitor-request', True),
    ('1.3', 'V-03 : CSP unsafe-inline permettant l\'execution XSS', True),
    ('2', 'Analyse de l\'authentification HMAC', False),
    ('3', 'Analyse du mecanisme CORS', False),
    ('4', 'Analyse de la Content-Security-Policy', False),
    ('5', 'Rate limiting - Limites du modele en memoire', False),
    ('6', 'Audit du moteur predictif', False),
    ('6.1', 'Les 17 coefficients arbitraires', True),
    ('6.2', 'AI_WEIGHT = 35% - Absence de validation', True),
    ('6.3', 'VIRTUAL_AVG_GOALS = 1.3 - Valeur non prouvee', True),
    ('6.4', 'Plafond de confiance 82% - Calibration absente', True),
    ('7', 'Couverture de tests', False),
    ('8', 'Architecture de securite (Neon/RLS)', False),
    ('9', 'Phases de remediation ordonnees', False),
    ('10', 'Risques residuels', False),
]
for num, title, sub in toc_items:
    sty = s['tocsub'] if sub else s['toc']
    prefix = f'<b>{num}</b>  ' if not sub else f'{num}  '
    story.append(Paragraph(prefix + title, sty))

story.append(PageBreak())

# SECTION 1: VULNERABILITIES
story.append(Paragraph('1. Vulnerabilites critiques identifiees', s['h1']))
story.append(Spacer(1, 6))
story.append(make_table(['ID', 'Severite', 'Titre', 'Statut'],
    [['V-01', 'CRITIQUE', 'Usurpation d\'identite par x-device-id', 'Fallback actif'],
     ['V-02', 'CRITIQUE', 'Contournement CORS par x-capacitor-request', 'Actif'],
     ['V-03', 'HAUTE', 'CSP unsafe-inline (execution XSS)', 'Actif']],
    [45, 70, 250, 95]))
story.append(Spacer(1, 12))

# V-01
story.append(Paragraph('1.1 V-01 : Usurpation d\'identite par x-device-id sans HMAC', s['h2']))
story.append(Paragraph(
    'La fonction <font face="NotoSansSC" color="#70bdd7">requireAuth()</font> dans <font face="NotoSansSC" color="#70bdd7">api/_lib/auth.js</font> '
    'implemente un mecanisme HMAC correct pour l\'authentification des devices, MAIS conserve un fallback qui accepte '
    'un simple header <font face="NotoSansSC" color="#d4b65b">x-device-id</font> sans verification cryptographique. '
    'Ce fallback existe dans trois vecteurs d\'entree differents : le header x-device-id, le champ body.device_id, '
    'et le parametre query.device_id. Chacun de ces vecteurs permet a un attaquant de se faire passer pour n\'importe quel device '
    'en fournissant simplement son identifiant.', s['body']))

story.append(Paragraph('<b>Fichiers concernes :</b>', s['body']))
story.append(code_block('api/_lib/auth.js          — lignes 190-225 (requireAuth fallback)\napi/predictions.js        — utilise requireAuth() pour GET/POST/DELETE\napi/premium-activate.js   — utilise requireAuth() pour GET (legacy) + POST\napi/verify-predictions.js — utilise requireAuth() pour mode client\napi/device-register.js    — accepte x-device-id pour registration\nsrc/lib/device.ts         — getAuthHeaders() fallback vers x-device-id'))

story.append(Paragraph('<b>Flux d\'attaque :</b>', s['body']))
for step in [
    '1. L\'attaquant identifie le device_id d\'une cible (format previsible : dev- + 8 char hex via djb2)',
    '2. L\'attaquant envoie une requete avec x-device-id: dev-cible000 (sans Authorization: Device token)',
    '3. Le serveur appelle requireAuth() qui echoue sur verifyDeviceToken() (pas de header Authorization)',
    '4. Le fallback accepte le plain device_id et retourne l\'identifiant de la cible',
    '5. L\'attaquant accede aux predictions, premium, et donnees de la cible',
]:
    story.append(Paragraph(step, s['bi']))

story.append(Paragraph('<b>Code vulnerable (api/_lib/auth.js, lignes 196-222) :</b>', s['body']))
story.append(code_block('const plainDeviceId = req.headers[\'x-device-id\'] || \'\';\nif (plainDeviceId && DEVICE_ID_RE.test(plainDeviceId)) {\n  console.warn(`[auth] FALLBACK: plain device_id accepted`);\n  return plainDeviceId;  // VULNERABILITE\n}\n// Egalement : body.device_id et query.device_id'))

story.append(Paragraph('<b>Impact :</b> Un attaquant peut lire les predictions d\'un autre utilisateur, activer du premium sur son propre device avec un code deja consomme par la cible, supprimer les predictions de la cible, et migrer les donnees via l\'endpoint admin.', s['body']))

story.append(Paragraph('<b>Plan de correction :</b>', s['body']))
for r in [
    '1. Ajouter un feature flag AUTH_LEGACY_FALLBACK=false dans les variables d\'environnement Vercel',
    '2. Conditionner le fallback a ce flag : if (process.env.AUTH_LEGACY_FALLBACK === "true") { ... }',
    '3. Logger chaque utilisation du fallback avec [auth] LEGACY: device_id=xxx ip=yyy',
    '4. Definir une date de desactivation : AUTH_LEGACY_DEADLINE=2026-09-23 (2 semaines)',
    '5. Apres la deadline, le fallback doit retourner null (401)',
    '6. Ne JAMAIS permettre l\'acces aux endpoints sensibles (premium, admin) via le fallback',
    '7. Ajouter un endpoint POST /api/migrate-auth qui force le re-enregistrement HMAC',
]:
    story.append(Paragraph(r, s['bi']))
story.append(Spacer(1, 10))

# V-02
story.append(Paragraph('1.2 V-02 : Contournement CORS par x-capacitor-request', s['h2']))
story.append(Paragraph(
    'La fonction <font face="NotoSansSC" color="#70bdd7">isOriginAllowed()</font> dans <font face="NotoSansSC" color="#70bdd7">api/_lib/cors.js</font> '
    'contient une verification qui accepte toute requete portant le header <font face="NotoSansSC" color="#d4b65b">x-capacitor-request</font> '
    'comme origine valide, sans aucune verification supplementaire. Un header HTTP est entierement controlable par le client : '
    'n\'importe quel site web malveillant peut envoyer ce header et contourner la protection CORS.', s['body']))

story.append(Paragraph('<b>Fichier concerne :</b>', s['body']))
story.append(code_block('api/_lib/cors.js — ligne 27 :\nif (reqHeaders?.[\'x-capacitor-request\']) return true;  // VULNERABILITE'))

story.append(Paragraph('<b>Flux d\'attaque :</b>', s['body']))
for step in [
    '1. Un site web malveillant evil.com veut appeler les APIs VirtuMatch depuis un navigateur',
    '2. evil.com ajoute le header x-capacitor-request: true a la requete cross-origin',
    '3. isOriginAllowed() retourne true car le header est present',
    '4. Le serveur renvoie Access-Control-Allow-Origin: evil.com',
    '5. Le navigateur autorise la requete cross-origin',
    '6. evil.com accede aux APIs comme si la requete provenait de l\'application Capacitor',
]:
    story.append(Paragraph(step, s['bi']))

story.append(Paragraph('<b>Impact :</b> Un site web externe peut appeler toutes les APIs VirtuMatch. Combine avec V-01 (fallback device_id), un attaquant distant peut acceder aux donnees de n\'importe quel utilisateur sans acceder physiquement a son appareil.', s['body']))

story.append(Paragraph('<b>Plan de correction :</b>', s['body']))
for r in [
    '1. Supprimer la ligne if (reqHeaders?.[\'x-capacitor-request\']) return true; de isOriginAllowed()',
    '2. Ajouter capacitor://localhost a la liste ALLOWED_ORIGINS (deja present dans DEFAULT_ORIGINS)',
    '3. Verifier que les requetes Capacitor natives envoient un Origin: capacitor://localhost valide',
    '4. Si un header supplementaire est necessaire, utiliser un secret partage verifie cote serveur',
    '5. La securite doit reposer sur : HMAC (V-01), origine valide, rate limiting, authorization',
    '6. CORS n\'est PAS une authentification — une requete non autorisee doit rester non autorisee',
]:
    story.append(Paragraph(r, s['bi']))
story.append(Spacer(1, 10))

# V-03
story.append(Paragraph('1.3 V-03 : CSP unsafe-inline permettant l\'execution XSS', s['h2']))
story.append(Paragraph(
    'La Content-Security-Policy definie dans <font face="NotoSansSC" color="#70bdd7">vercel.json</font> utilise '
    '<font face="NotoSansSC" color="#d4b65b">unsafe-inline</font> dans les directives script-src et style-src. '
    'Cela desactive la protection principale de la CSP contre les attaques XSS. De plus, index.html contient '
    'un bloc script inline (lignes 138-157) et un bloc style inline (lignes 37-104).', s['body']))

story.append(Paragraph('<b>Fichiers concernes :</b>', s['body']))
story.append(code_block('vercel.json  — ligne 31 : script-src \'self\' \'unsafe-inline\' https://cdn.jsdelivr.net\nvercel.json  — ligne 31 : style-src \'self\' \'unsafe-inline\' https://cdn.jsdelivr.net\nindex.html   — lignes 37-104 : <style> inline\nindex.html   — lignes 138-157 : <script> inline'))

story.append(Paragraph('<b>Plan de correction :</b>', s['body']))
for r in [
    '1. Extraire les scripts inline de index.html vers des fichiers .js externes',
    '2. Extraire les styles inline vers des fichiers .css externes',
    '3. Remplacer unsafe-inline par des nonces CSP : script-src \'self\' \'nonce-{random}\'',
    '4. Generer un nonce unique par requete cote serveur (Vite plugin CSP)',
    '5. Alternative : utiliser des hashes CSP (sha256-) pour les scripts inline statiques',
    '6. Tester exhaustivement : production build, dev mode, app Capacitor, pages admin/premium',
]:
    story.append(Paragraph(r, s['bi']))

story.append(PageBreak())

# SECTION 2: HMAC ANALYSIS
story.append(Paragraph('2. Analyse de l\'authentification HMAC', s['h1']))
story.append(Paragraph(
    'Le mecanisme HMAC implemente dans api/_lib/auth.js est architecturalement solide mais presente des faiblesses '
    'specifiques qui reduisent considerablement la securite theorique du mecanisme, en particulier le fallback plain device_id.', s['body']))

story.append(Paragraph('2.1 Points forts', s['h2']))
for p in [
    'Secret per-device genere avec crypto.randomBytes(32) — entropie suffisante',
    'Secret expose une seule fois lors du registerDevice() — jamais re-expose ensuite',
    'Verification avec crypto.timingSafeEqual() — protection contre les timing attacks',
    'Token expire apres 7 jours (TOKEN_EXPIRY_MS) — fenetre de damage limitee',
    'Format du token (base64url(timestamp).base64url(hmac)) standard et securise',
    'Device_id valide avec regex DEVICE_ID_RE = /^dev-[a-z0-9]{8,}$/',
]:
    story.append(Paragraph(p, s['bi']))

story.append(Paragraph('2.2 Faiblesses identifiees', s['h2']))
for w in [
    '<b>Absence de nonce/anti-replay :</b> Le token ne contient pas de nonce. Un attaquant qui intercepte un token valide peut le reutiliser pendant 7 jours.',
    '<b>Pas de canonicalisation de la requete :</b> La signature ne couvre que deviceId + timestamp. La methode HTTP, le path, et le body ne sont pas inclus.',
    '<b>Lookup par x-device-id hint :</b> verifyDeviceToken() utilise le header x-device-id comme hint pour retrouver le secret. Couplage fragile.',
    '<b>Fallback requireAuth() :</b> Le fallback plain device_id (V-01) rend tout le mecanisme HMAC contournable.',
    '<b>Duree de vie de 7 jours :</b> Un token compromis (via XSS) reste valide 7 jours. Une duree plus courte (1-24h) serait preferable.',
]:
    story.append(Paragraph(w, s['bi']))

story.append(Paragraph('2.3 Recommendations HMAC v2', s['h2']))
for r in [
    'Ajouter un nonce crypto.randomBytes(16) a chaque token pour empecher le replay',
    'Inclure method + path + body_hash dans le message signe (canonical request)',
    'Reduire TOKEN_EXPIRY_MS a 24h avec renouvellement transparent cote client',
    'Supprimer le fallback plain device_id (V-01) immediatement avec feature flag',
    'Implementer une rotation des secrets per-device (periodique ou sur suspicion)',
    'Logger les echecs de verification HMAC avec IP + timestamp pour detection d\'attaques',
]:
    story.append(Paragraph(r, s['bi']))

story.append(PageBreak())

# SECTION 3: CORS
story.append(Paragraph('3. Analyse du mecanisme CORS', s['h1']))
story.append(Paragraph(
    'Le mecanisme CORS est implemente dans api/_lib/cors.js et utilise par toutes les API routes via setCorsHeaders(). '
    'L\'implementation presente un mix de bonnes pratiques et de vulnerabilites. Le header Vary: Origin est correctement defini '
    '(previent le cache poisoning CDN). La duree de cache preflight est de 1 heure (bon compromis).', s['body']))

story.append(Paragraph('3.1 Politique CORS par type d\'API', s['h2']))
story.append(make_table(['Type d\'API', 'Protection actuelle', 'Protection requise'],
    [['API publique (matches)', 'Aucune auth + CORS lax', 'Rate limiting + CORS stricte'],
     ['API auth (predictions)', 'requireAuth() + CORS', 'HMAC obligatoire + CORS stricte'],
     ['API premium', 'requireAuth/requireUserAuth + CORS', 'User auth + CORS stricte'],
     ['API admin', 'Bearer token + origin check', 'Bearer token + CORS stricte + IP whitelist'],
     ['API cron', 'x-cron-key + timingSafeEqual', 'Deja correct']],
    [120, 170, 170]))
story.append(Spacer(1, 10))

story.append(Paragraph('<b>Principe fondamental :</b> CORS n\'est PAS un mecanisme d\'authentification. Une requete non autorisee doit rester non autorisee meme si elle possede x-capacitor-request: true. La vraie protection doit reposer sur HMAC, Bearer token, x-cron-key, verification d\'origine, rate limiting, et authorization.', s['body']))

story.append(PageBreak())

# SECTION 4: CSP
story.append(Paragraph('4. Analyse de la Content-Security-Policy', s['h1']))
story.append(make_table(['Directive', 'Valeur actuelle', 'Statut', 'Recommandation'],
    [["default-src", "'self'", 'Correct', 'Conserver'],
     ["script-src", "'self' 'unsafe-inline' cdn.jsdelivr.net", 'VULNERABLE', 'Retirer unsafe-inline, ajouter nonce/hash'],
     ["style-src", "'self' 'unsafe-inline' cdn.jsdelivr.net", 'VULNERABLE', 'Retirer unsafe-inline, ajouter nonce/hash'],
     ["img-src", "'self' data: blob: lh3.google...", 'Acceptable', 'Verifier si data:/blob: necessaires'],
     ["font-src", "'self'", 'Correct', 'Conserver'],
     ["connect-src", "'self' *.vercel.app", 'Correct', 'Conserver'],
     ["frame-ancestors", "'none'", 'Correct (anti-clickjacking)', 'Conserver'],
     ["base-uri", "'self'", 'Correct', 'Conserver'],
     ["form-action", "'self'", 'Correct', 'Conserver']],
    [80, 175, 80, 125]))
story.append(Spacer(1, 10))

story.append(Paragraph(
    'Deux blocs inline dans index.html : le bloc style (lignes 37-104) pour l\'animation de chargement, et le bloc script '
    '(lignes 138-157) pour le masquage du loader et la gestion des erreurs. Ces blocs sont des candidats ideals pour '
    'l\'extraction vers des fichiers externes, car ils sont statiques.', s['body']))

story.append(PageBreak())

# SECTION 5: RATE LIMITING
story.append(Paragraph('5. Rate limiting - Limites du modele en memoire', s['h1']))
story.append(Paragraph(
    'Le projet utilise un rate limiting base sur Map() en memoire dans middleware.js (30 req/min), predictions.js (30 req/min), '
    'et premium-activate.js (15 req/heure). Ce modele est inadequat pour un environnement Vercel Serverless.', s['body']))

story.append(Paragraph('5.1 Problemes du Map() en memoire', s['h2']))
for p in [
    '<b>Cold starts :</b> Chaque invocation serverless demarre un nouveau processus. Le Map() est vide a chaque cold start. Un attaquant peut contourner le rate limiting simplement en attendant un cold start.',
    '<b>Isolation des instances :</b> Vercel peut executer plusieurs instances en parallele. Chacune a son propre Map(). Un attaquant peut envoyer 30 requetes par instance et par minute.',
    '<b>Pas de persistance :</b> Le Map() ne survit pas entre les invocations si Vercel recree le processus.',
    '<b>Nettoyage insuffisant :</b> Le nettoyage dans middleware.js ne se declenche que quand le Map() depasse 10000 entrees.',
]:
    story.append(Paragraph(p, s['bi']))

story.append(Paragraph(
    '<b>Recommandation :</b> Migrer vers Upstash Redis (deja documente dans middleware.js). '
    'Limites differenciees par endpoint : auth (5/min), predictions (30/min), analyze-match (10/min), '
    'device-register (5/min), premium (15/heure), admin (5/15min), verify (10/min).', s['body']))

story.append(PageBreak())

# SECTION 6: PREDICTION ENGINE
story.append(Paragraph('6. Audit du moteur predictif', s['h1']))
story.append(Paragraph(
    'Le moteur predictif (src/lib/prediction-engine.ts, 1344 lignes) est un monolithe implementant un modele de prediction '
    'base sur la distribution de Poisson avec ajustements heuristiques multiples. L\'audit revele 17 coefficients arbitraires, '
    'aucune validation empirique, et un score de confiance heuristique non calibre.', s['body']))

story.append(Paragraph('6.1 Les 17 coefficients arbitraires', s['h2']))
story.append(make_table(['Coefficient', 'Valeur', 'Ligne', 'Role'],
    [['VIRTUAL_AVG_GOALS', '1.3', ':366', 'Moyenne buts virtuelle'],
     ['AI_WEIGHT', '0.35', ':517', 'Poids fusion IA'],
     ['FORM_WEIGHTS', '[1.5,1.3,1.2,1.1,1.0]', ':241', 'Poids forme recente'],
     ['Stats blend', '0.70/0.20/0.10', ':396-404', 'Mix stats/cotes/defense'],
     ['Form attack boost', '0.15', ':432', 'Boost attaque forme'],
     ['Form defense penalty', '0.10', ':433', 'Penalite defense forme'],
     ['Momentum diviseur', '500', ':448', 'Echelle momentum'],
     ['H2H boost diviseur', '200', ':459', 'Echelle H2H'],
     ['H2H weight', '0.5 / 0.3', ':460-461', 'Poids H2H home/away'],
     ['Lambda clamp', '[0.3, 2.8]', ':409-411', 'Bornes lambda'],
     ['New season boost', '0.22', ':920-922', 'Boost favori nvlle saison'],
     ['Confidence base', '85 (max 68%)', ':769', 'Base confiance'],
     ['Confidence plafond', '82%', ':810', 'Plafond confiance'],
     ['Confidence plancher', '25%', ':810', 'Plancher confiance'],
     ['Anti-trap penalite', '5%/alerte', ':792', 'Penalite anti-trap'],
     ['Trap penalite', '12% / 5%', ':805-806', 'Penalite vrai/faux trap'],
     ['Redistrib. bonus', '1.04-1.15', ':589-592', 'Bonus scores virtuels']],
    [105, 85, 65, 205]))
story.append(Spacer(1, 10))

story.append(Paragraph(
    'Aucun de ces 17 coefficients n\'est valide empiriquement. Ils sont choisis intuitivement sans backtesting, '
    'sans comparaison avec des baselines, et sans validation hors echantillon.', s['body']))

story.append(Paragraph('6.2 AI_WEIGHT = 35% - Absence de validation', s['h2']))
story.append(Paragraph(
    'Le poids de 35% accorde a la prediction IA est le coefficient le plus impactant. Si l\'IA ne fournit aucune information '
    'predictive supplementaire par rapport aux cotes seules, ce poids represente du bruit injecte dans le modele. '
    'Il faut comparer OBJECTIVEMENT les performances avec et sans IA sur des donnees hors echantillon (Brier Score, Log Loss). '
    'Si l\'IA degrade ces metriques, le poids doit etre reduit a 0%.', s['body']))

story.append(Paragraph('6.3 VIRTUAL_AVG_GOALS = 1.3 - Valeur non prouvee', s['h2']))
story.append(Paragraph(
    'Cette constante est utilisee comme reference pour attackStrength = avgGoalsScored / VIRTUAL_AVG_GOALS. '
    'Elle n\'est basee sur aucune donnee historique. Il faut calculer la moyenne reelle, analyser la distribution '
    '(moyenne, mediane, variance, overdispersion), et verifier si 1.3 est statistiquement justifie.', s['body']))

story.append(Paragraph('6.4 Plafond de confiance 82% - Calibration absente', s['h2']))
story.append(Paragraph(
    'Le plafond de 82% est heuristique. Une prediction a 82% ne signifie PAS que le modele a raison 82% du temps. '
    'Il faut implementer une calibration probabiliste reelle (Platt Scaling, Isotonic Regression, Beta Calibration) '
    'pour que les scores de confiance correspondent a des probabilites calibrees.', s['body']))

story.append(PageBreak())

# SECTION 7: TESTS
story.append(Paragraph('7. Couverture de tests', s['h1']))
story.append(Paragraph(
    'La couverture de tests est pratiquement nulle. Le seul fichier de test est src/test/example.test.ts '
    'qui contient un unique test placeholder : expect(true).toBe(true). Aucune logique metier n\'est testee.', s['body']))

story.append(make_table(['Categorie', 'Tests actuels', 'Tests requis (minimum)'],
    [['Prediction engine', '0', '13+ (odds, poisson, form, h2h, calibration...)'],
     ['API auth', '0', '6+ (HMAC valide/invalide, fallback, expiration...)'],
     ['API predictions', '0', '5+ (CRUD, ownership, validation, rate limit)'],
     ['API premium', '0', '4+ (activation, reactivation, code use, migration)'],
     ['API admin', '0', '4+ (login, token, code management, migration)'],
     ['CORS', '0', '3+ (origin check, capacitor bypass, self-referencing)'],
     ['CSP', '0', '2+ (inline script block, XSS prevention)'],
     ['Total', '1 (placeholder)', '37+ tests minimum']],
    [130, 100, 230]))

story.append(PageBreak())

# SECTION 8: ARCHITECTURE
story.append(Paragraph('8. Architecture de securite (Neon/RLS)', s['h1']))
story.append(Paragraph(
    'L\'architecture repose sur le principe que NEON_DATABASE_URL n\'est jamais expose au client. Toutes les requetes '
    'passent par les API Routes Vercel. Cependant, le role neondb_owner a rolbypassrls=true, ce qui rend les politiques '
    'RLS inoperantes. La protection repose entierement sur l\'isolation de la connection string et l\'authentification '
    'des API Routes.', s['body']))

story.append(make_table(['Composant', 'Statut', 'Details'],
    [['NEON_DATABASE_URL isole', 'Correct', 'Jamais expose au client (pas de VITE_*)'],
     ['API Routes comme proxy', 'Correct', 'Seul point d\'entree vers la DB'],
     ['RLS (Row Level Security)', 'Inopereant', 'neondb_owner bypass RLS + auth.role() absent'],
     ['ADMIN_TOKEN_SECRET', 'Correct', 'HMAC-SHA256 + timingSafeEqual, 24h expiry'],
     ['USER_SESSION_SECRET', 'Correct', 'HMAC-SHA256, 30 jours, Bearer token'],
     ['CRON_SECRET', 'Correct', 'timingSafeEqual, header x-cron-key'],
     ['Magic links', 'Correct', 'Token hash SHA-256, usage unique, 15 min expiry'],
     ['Supabase purge', 'Complete', 'Client supabase-js supprime, anon key supprimee']],
    [140, 80, 240]))

story.append(PageBreak())

# SECTION 9: REMEDIATION PHASES
story.append(Paragraph('9. Phases de remediation ordonnees', s['h1']))
story.append(Paragraph(
    'L\'ordre de remediation est obligatoire. Aucune phase ne peut etre sautee. Le moteur de prediction ne doit PAS etre '
    'modifie avant que les APIs critiques soient securisees.', s['body']))

story.append(make_table(['Phase', 'Titre', 'Priorite', 'Deps', 'Est.'],
    [['A', 'Securite (V-01, V-02, V-03)', 'CRITIQUE', 'Aucune', '2-3j'],
     ['B', 'Tests de securite', 'CRITIQUE', 'Phase A', '2-3j'],
     ['C', 'CSP stricte', 'HAUTE', 'Phase A', '1-2j'],
     ['D', 'Rate limiting (Upstash)', 'HAUTE', 'Phase A', '1-2j'],
     ['E', 'HMAC v2 (nonce, canonical)', 'HAUTE', 'A+B', '3-4j'],
     ['F', 'Backtesting framework', 'MOYENNE', 'A+B', '5-7j'],
     ['G', 'Baselines & comparaison', 'MOYENNE', 'F', '3-5j'],
     ['H', 'Metriques & calibration', 'MOYENNE', 'F+G', '3-5j'],
     ['I', 'Audit des 17 coefficients', 'MOYENNE', 'F+G+H', '2-3j'],
     ['J', 'AI_WEIGHT validation', 'MOYENNE', 'H', '1-2j'],
     ['K', 'Refactoring du moteur', 'BASSE', 'I+J', '3-5j'],
     ['L', 'CI/CD & test coverage', 'BASSE', 'B', '2-3j'],
     ['M', 'Nouvelles features', 'BASSE', 'K+L', 'Variable']],
    [35, 155, 65, 55, 50]))
story.append(Spacer(1, 10))

story.append(Paragraph(
    '<b>Regle absolue :</b> Les phases A et B doivent etre completees avant toute autre phase. '
    'Le moteur predictif (F-K) ne doit pas etre modifie avant que les APIs soient securisees (A), testees (B), '
    'et que le framework de backtesting soit operationnel (F). Toute optimisation prematuree est une regression.', s['body']))

story.append(PageBreak())

# SECTION 10: RESIDUAL RISKS
story.append(Paragraph('10. Risques residuels', s['h1']))
story.append(make_table(['Risque', 'Sev.', 'Prob.', 'Mitigation'],
    [['Fuite NEON_DATABASE_URL', 'CRIT', 'Faible', 'Pas de VITE_*, push protection, audit builds'],
     ['Compromission ADMIN_TOKEN_SECRET', 'CRIT', 'Faible', 'Rotation periodique, monitoring'],
     ['XSS dans composants React', 'HAUT', 'Moyen', 'CSP stricte (Phase C), React auto-escaping'],
     ['Timing attack sur HMAC', 'MOY', 'Faible', 'timingSafeEqual deja utilise'],
     ['Race condition premium', 'MOY', 'Moyen', 'Transaction SQL FOR UPDATE deja implementee'],
     ['Cold start rate limit bypass', 'MOY', 'Eleve', 'Migration Upstash (Phase D)'],
     ['Overfitting moteur predictif', 'MOY', 'Eleve', 'Backtesting + validation temporelle'],
     ['Device fingerprint collision', 'BAS', 'Faible', 'djb2 32 bits - collision improbable'],
     ['Magic link interception', 'BAS', 'Faible', 'HTTPS, 15min, usage unique, SHA-256']],
    [155, 40, 50, 215]))
story.append(Spacer(1, 15))

story.append(Paragraph(
    'Ce rapport constitue l\'audit Phase 1 (lecture seule) du repository VirtuMatch Predictor. Aucun fichier n\'a ete modifie '
    'durant cet audit. Les corrections proposees doivent etre implementees dans l\'ordre des phases definies en section 9, '
    'en commencant par la securisation des APIs critiques (Phase A) avant toute modification du moteur predictif.', s['body']))

# BUILD
doc.build(story, onFirstPage=header_footer, onLaterPages=header_footer)
print(f'PDF genere : {OUTPUT_PATH}')
print(f'Taille : {os.path.getsize(OUTPUT_PATH)} octets')
