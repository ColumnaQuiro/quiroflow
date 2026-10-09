# R8 rules for the QuiroFlow app (release builds shrink; see build.gradle).
#
# Capacitor's plugins (@CapacitorPlugin classes and their @PluginMethod
# methods, which the bridge finds by reflection) are kept by the rules that
# ship inside capacitor-android as consumerProguardFiles -- they apply here
# without being repeated. Firebase Messaging ships its own too, and its
# service is kept through the manifest.

# The web view's JavaScript bridge: methods called from JS by name.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Readable crash stack traces in Play Console, with the mapping file
# uploaded beside the AAB.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
