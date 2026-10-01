plugins {
    id("com.android.application")
    kotlin("android")
    kotlin("plugin.compose")
}

// One version for everything: the CLI's (scripts/version.py). versionCode = MAJOR*1_000_000 + MINOR*1_000 + PATCH.
val qbeamVersion: MatchResult = Regex("""__version__ = "(\d+)\.(\d+)\.(\d+)"""")
    .find(rootDir.resolve("../py/src/qbeam/__init__.py").readText()) ?: error("no __version__ in py/src/qbeam/__init__.py")
val (vMajor, vMinor, vPatch) = qbeamVersion.destructured

// Release signing from the environment (the release workflow decodes the key from a GitHub secret). Without it,
// local release builds use the debug key, which is fine for speed tests and never published.
val releaseKeystore: String? = System.getenv("QBEAM_KEYSTORE")

android {
    namespace = "dev.qbeam.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.qbeam.app"
        minSdk = 29          // Android 10+: scoped storage (MediaStore Downloads) without extra permissions
        targetSdk = 36
        versionCode = vMajor.toInt() * 1_000_000 + vMinor.toInt() * 1_000 + vPatch.toInt()
        versionName = "$vMajor.$vMinor.$vPatch"
    }

    // foss: GitHub releases, IzzyOnDroid, F-Droid. No Google libraries at all, no trial. The default.
    // play: Google Play, with Play Billing and the trial switch: -Pqbeam.trial=true turns it on.
    flavorDimensions += "store"
    productFlavors {
        create("foss") {
            dimension = "store"
            isDefault = true
            buildConfigField("boolean", "TRIAL", "false")
        }
        create("play") {
            dimension = "store"
            buildConfigField("boolean", "TRIAL", (findProperty("qbeam.trial") ?: "false").toString())
        }
    }

    signingConfigs {
        create("release") {
            if (releaseKeystore != null) {
                storeFile = file(releaseKeystore)
                storePassword = System.getenv("QBEAM_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("QBEAM_KEY_ALIAS")
                keyPassword = System.getenv("QBEAM_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName(if (releaseKeystore != null) "release" else "debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { compose = true; buildConfig = true }
    // The dependency-info block is encrypted for Google; F-Droid and IzzyOnDroid reject APKs that carry it.
    dependenciesInfo {
        includeInApk = false
        includeInBundle = true
    }
}

kotlin { jvmToolchain(17) }

dependencies {
    implementation(project(":core"))
    implementation("io.github.zxing-cpp:android:3.1.1")

    val camerax = "1.5.2" // the version zxing-cpp 3.1.1 is built against
    implementation("androidx.camera:camera-camera2:$camerax")
    implementation("androidx.camera:camera-lifecycle:$camerax")
    implementation("androidx.camera:camera-view:$camerax")

    implementation(platform("androidx.compose:compose-bom:2025.10.01")) // last BOM for compileSdk 36 / AGP 8.x
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.activity:activity-compose:1.11.0")
    "playImplementation"("com.android.billingclient:billing:9.1.0") // its INTERNET is stripped in AndroidManifest.xml
}
