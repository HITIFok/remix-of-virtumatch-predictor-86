# 📱 Guide de Build APK - Virtual Bet261

## 🚀 Méthode Rapide (Recommandée)

### Prérequis
- **Node.js** 18+ 
- **Android Studio** avec SDK Android
- **JDK 17 ou 21**

### Étapes

```bash
# 1. Cloner le projet
git clone https://github.com/HITIFok/remix-of-virtumatch-predictor-86.git
cd remix-of-virtumatch-predictor-86

# 2. Installer les dépendances
npm install

# 3. Build le projet web
npm run build

# 4. Sync Capacitor
npx cap sync android

# 5. Build l'APK
cd android
./gradlew assembleDebug

# 6. Renommer l'APK
mv app/build/outputs/apk/debug/app-debug.apk "../Virtual Bet261.apk"
```

---

## 📂 Structure du Projet

```
remix-of-virtumatch-predictor-86/
├── android/              # Projet Android natif
│   ├── app/
│   │   ├── build/outputs/apk/debug/  # APK généré ici
│   │   └── src/main/
│   │       ├── assets/public/         # Web assets
│   │       ├── res/                   # Ressources Android
│   │       └── AndroidManifest.xml
│   └── gradlew           # Script de build
├── capacitor.config.ts   # Configuration Capacitor
├── build-apk.sh          # Script automatique
└── src/                  # Code source React
```

---

## ⚙️ Configuration

### App ID
```
com.hitif.virtuxxs
```

### Nom de l'app
```
Virtual Bet261
```

### Couleurs
- **Background**: `#0a0a0d` (noir profond)
- **Primary**: `#ff6b35` (orange fire)
- **Accent**: `#38bdf8` (ice blue)

---

## 🔧 Build avec Android Studio

1. Ouvrir **Android Studio**
2. **File → Open** → Sélectionner le dossier `android/`
3. Attendre la synchronisation Gradle
4. **Build → Build Bundle(s) / Build APK(s) → Build APK(s)**
5. L'APK est dans: `android/app/build/outputs/apk/debug/app-debug.apk`

---

## 📋 Release Build (APK signé)

```bash
# Générer le keystore
keytool -genkey -v -keystore virtualbet261.keystore -alias virtualbet261 -keyalg RSA -keysize 2048 -validity 10000

# Build release
cd android
./gradlew assembleRelease

# Signer l'APK
jarsigner -verbose -sigalg SHA1withRSA -digestalg SHA1 -keystore ../virtualbet261.keystore app/build/outputs/apk/release/app-release-unsigned.apk virtualbet261

# Optimiser avec zipalign
zipalign -v 4 app/build/outputs/apk/release/app-release-unsigned.apk ../Virtual\ Bet261.apk
```

---

## 🌐 PWA (Alternative)

L'application est aussi une **PWA** et peut être installée directement depuis le navigateur :

1. Déployer sur Vercel
2. Ouvrir l'app dans Chrome sur mobile
3. Menu → "Ajouter à l'écran d'accueil"

---

## 🛠️ Dépannage

### Erreur: "SDK location not found"
```bash
# Créer local.properties
echo "sdk.dir=/home/user/Android/Sdk" > android/local.properties
```

### Erreur: "Could not find or load main class org.gradle.wrapper.GradleWrapperMain"
```bash
cd android
./gradlew --version
```

### Erreur: "Unable to locate a Java Runtime"
Installer OpenJDK 17:
```bash
sudo apt install openjdk-17-jdk
```

---

## 📞 Support

- GitHub: https://github.com/HITIFok/remix-of-virtumatch-predictor-86
- Facebook: https://facebook.com/hitif
- WhatsApp: 0383061076
