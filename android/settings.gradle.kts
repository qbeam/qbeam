// qbeam Android. `core` is the protocol v3 codec (pure Kotlin/JVM, tested against protocol/test-vectors);
// the app module is added once Android Studio is installed on the dev machine.
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
include(":core")
