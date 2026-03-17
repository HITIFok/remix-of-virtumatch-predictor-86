#!/bin/bash
# ================================================
# 📱 Build APK Virtual Bet261
# ================================================
# Exécutez ce script sur votre machine locale
# Prérequis: JDK 17+, Android SDK

set -e

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo -e "${BLUE}🔥 Virtual Bet261 - Build APK${NC}"
echo -e "${BLUE}================================${NC}"
echo ""

# Vérifier JDK
echo -e "${YELLOW}📋 Vérification des prérequis...${NC}"
if ! command -v javac &> /dev/null; then
    echo -e "${RED}❌ JDK non trouvé!${NC}"
    echo "   Installez OpenJDK 17 ou 21:"
    echo "   Ubuntu/Debian: sudo apt install openjdk-17-jdk"
    echo "   macOS: brew install openjdk@17"
    exit 1
fi
echo -e "${GREEN}✅ JDK: $(javac -version 2>&1)${NC}"

# Vérifier ANDROID_HOME
if [ -z "$ANDROID_HOME" ]; then
    # Essayer de détecter automatiquement
    if [ -d "$HOME/Android/Sdk" ]; then
        export ANDROID_HOME="$HOME/Android/Sdk"
    elif [ -d "/opt/android-sdk" ]; then
        export ANDROID_HOME="/opt/android-sdk"
    elif [ -d "$HOME/Library/Android/sdk" ]; then
        export ANDROID_HOME="$HOME/Library/Android/sdk"
    fi
fi

if [ -z "$ANDROID_HOME" ]; then
    echo -e "${YELLOW}⚠️ ANDROID_HOME non défini${NC}"
    echo "   Définissez la variable ANDROID_HOME"
else
    echo -e "${GREEN}✅ Android SDK: $ANDROID_HOME${NC}"
fi

# Aller au répertoire du projet
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Install dependencies
echo ""
echo -e "${YELLOW}📦 Installation des dépendances...${NC}"
npm install

# Build web
echo ""
echo -e "${YELLOW}🏗️ Build du projet web...${NC}"
npm run build

# Sync Capacitor
echo ""
echo -e "${YELLOW}🔄 Synchronisation Capacitor...${NC}"
npx cap sync android

# Build APK
echo ""
echo -e "${YELLOW}🤖 Compilation de l'APK...${NC}"
cd android
chmod +x gradlew
./gradlew assembleDebug --warning-mode=none

# Créer l'APK final
cd ..
APK_SOURCE="android/app/build/outputs/apk/debug/app-debug.apk"
APK_DEST="Virtual Bet261.apk"

if [ -f "$APK_SOURCE" ]; then
    cp "$APK_SOURCE" "$APK_DEST"
    echo ""
    echo -e "${GREEN}================================${NC}"
    echo -e "${GREEN}✅ APK créé avec succès!${NC}"
    echo -e "${GREEN}================================${NC}"
    echo ""
    echo -e "📁 Fichier: ${BLUE}$APK_DEST${NC}"
    echo -e "📏 Taille: $(du -h "$APK_DEST" | cut -f1)"
    echo ""
    echo -e "📱 Pour installer:"
    echo -e "   1. Transférez l'APK sur votre téléphone"
    echo -e "   2. Ouvrez le fichier depuis votre téléphone"
    echo -e "   3. Autorisez l'installation depuis sources inconnues"
    echo ""
else
    echo -e "${RED}❌ Build échoué - APK non trouvé${NC}"
    exit 1
fi
