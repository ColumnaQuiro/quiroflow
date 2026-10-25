# R8 rules for the QuiroFlow app (release builds shrink; see build.gradle).
#
# Capacitor's plugins (@CapacitorPlugin classes and their @PluginMethod
# methods, which the bridge finds by reflection) are kept by the rules that
# ship inside capacitor-android as consumerProguardFiles -- they apply here
# without being repeated. Firebase Messaging ships its own too, and its
# service is kept through the manifest.
#
# Those consumer rules keep the annotated classes but not the annotation
# TYPES, and R8 full mode (AGP 8's default) then decides that
# getAnnotation(CapacitorPlugin.class) can never return anything: it drops
# PluginHandle.pluginAnnotation and compiles Plugin.getPermissionStates() to
# `throw null`. Every plugin call that reaches the permission helpers kills
# the app -- FirebaseMessaging.requestPermissions() at startup on Android 13+
# (QUIROFLOW-APP-4; every release since R8 was switched on in 1.11).
# -keepattributes *Annotation* does not help. Capacitor 8 ships these rules
# itself (ionic-team/capacitor#8589, #8646); 7.x does not, so they live here
# until the upgrade.
-keep @interface com.getcapacitor.annotation.** { *; }
-keep @interface com.getcapacitor.PluginMethod { *; }
-keep @interface com.getcapacitor.NativePlugin { *; }

# The web view's JavaScript bridge: methods called from JS by name.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# The bridge reads each plugin's @CapacitorPlugin annotation (name and
# permissions) by reflection. Keeping the class does not keep the annotation:
# R8 drops annotation attributes nobody keeps, and a plugin that lost its
# annotation crashes the app the first time the bridge asks for its
# permissions (QUIROFLOW-APP-4: NullPointerException in
# Bridge.getPermissionStates from FirebaseMessaging.requestPermissions, a
# fatal on a release build only).
-keepattributes *Annotation*

# Readable crash stack traces in Play Console, with the mapping file
# uploaded beside the AAB.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# The bono-pass scanner (io.ionic.libs:ionbarcode-android, via the Capacitor
# barcode plugin, #810) annotates its parameter model with Gson's
# @SerializedName without depending on Gson, so R8 stops at the missing
# annotation. Nothing reads that annotation without Gson, so it is safe to
# ignore; the library is kept whole in case it reads its model reflectively.
-dontwarn com.google.gson.annotations.SerializedName
-keep class com.outsystems.plugins.barcode.** { *; }
