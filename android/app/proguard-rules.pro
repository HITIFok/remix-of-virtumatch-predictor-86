# ProGuard rules for Virutel Bet261
# Optimisation et obfuscation du code

# Garder les attributs pour le debugging
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Garder les classes Capacitor
-keep class com.getcapacitor.** { *; }
-keep class capacitor.** { *; }
-keep class com.capacitorjs.** { *; }

# Garder les classes Android essentielles
-keep class * extends android.app.Activity
-keep class * extends android.app.Service
-keep class * extends android.view.View

# Garder les annotations
-keepattributes *Annotation*

# Garder les classes sérialisables
-keepclassmembers class * implements java.io.Serializable {
    static final long serialVersionUID;
    private static final java.io.ObjectStreamField[] serialPersistentFields;
    !static !transient <fields>;
    private void writeObject(java.io.ObjectOutputStream);
    private void readObject(java.io.ObjectInputStream);
    java.lang.Object writeReplace();
    java.lang.Object readResolve();
}

# Optimisations agressives
-optimizationpasses 5
-dontusemixedcaseclassnames
-dontskipnonpubliclibraryclasses
-verbose

# Optimisations
-optimizations !code/simplification/arithmetic,!field/*,!class/merging/*,!code/allocation/variable

# Supprimer les logs en production
-assumenosideeffects class android.util.Log {
    public static boolean isLoggable(java.lang.String, int);
    public static int v(...);
    public static int i(...);
    public static int w(...);
    public static int d(...);
}

-assumenosideeffects class java.io.PrintStream {
    public void println(...);
    public void print(...);
}

# Garder les méthodes natives
-keepclasseswithmembernames class * {
    native <methods>;
}

# Garder les enums
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# Garder les Parcelable
-keepclassmembers class * implements android.os.Parcelable {
    static ** CREATOR;
}

# WebView JavaScript Interface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# R8 full mode
-keep class com.hitif.virutelbet261.** { *; }
