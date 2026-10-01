// qbeam Android. `core` is the protocol v3 codec (pure Kotlin/JVM, tested against protocol/test-vectors);
// `app` is the receiver app (CameraX + zxing-cpp + Compose).
pluginManagement {
    repositories {
        gradlePluginPortal()
        google()
        mavenCentral()
    }
}
dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "qbeam"
include(":core", ":app")
