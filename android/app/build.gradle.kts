plugins {
    id("com.android.application")
    kotlin("android")
    kotlin("plugin.compose")
}

android {
    namespace = "dev.qbeam.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.qbeam.app"
        minSdk = 29          // Android 10+: scoped storage (MediaStore Downloads) without extra permissions
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { compose = true }
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
}
