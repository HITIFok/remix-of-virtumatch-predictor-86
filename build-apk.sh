#!/bin/bash
# Script de build pour créer l'APK Virtual Bet261
# Exécutez ce script sur une machine avec Android Studio / SDK installé

echo "🔥 Build APK Virtual Bet261"
echo "============================"

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Vérifier Java JDK
if ! command -v javac &> /dev/null; then
    echo -e "${RED}❌ JDK non trouvé. Installez OpenJDK 17 ou 21${NC}"
    exit 1
fi

echo -e "${GREEN}✅ JDK trouvé: $(javac -version 2>&1)${NC}"

# Vérifier ANDROID_HOME
if [ -z "$ANDROID_HOME" ]; then
    echo -e "${YELLOW}⚠️ ANDROID_HOME non défini${NC}"
    echo "Définissez ANDROID_HOME vers votre SDK Android"
    echo "Exemple: export ANDROID_HOME=/home/user/Android/Sdk"
fi

# Aller au répertoire du projet
cd "$(dirname "$0")"

# Build web
echo ""
echo "📦 Build web..."
npm run build

# Sync Capacitor
echo ""
echo "🔄 Sync Capacitor..."
npx cap sync android

# Build APK
echo ""
echo "🤖 Build APK..."
cd android
./gradlew assembleDebug

# Renommer l'APK
cd ..
if [ -f "android/app/build/outputs/apk/debug/app-debug.apk" ]; then
    mv android/app/build/outputs/apk/debug/app-debug.apk "Virtual Bet261.apk"
    echo ""
    echo -e "${GREEN}✅ APK créé: Virtual Bet261.apk${NC}"
    echo "📱 Vous pouvez maintenant installer l'APK sur votre appareil Android"
else
    echo -e "${RED}❌ Build échoué${NC}"
    exit 1
fi
