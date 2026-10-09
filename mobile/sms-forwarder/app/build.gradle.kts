plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.detomsite.smsagent"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.detomsite.smsagent"
        minSdk = 23
        targetSdk = 34
        versionCode = 2
        versionName = "1.1"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        viewBinding = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.google.android.material:material:1.11.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // Guaranteed SMS-proof delivery: SmsReceiver enqueues this when the
    // goAsync window (<10s per Android BroadcastReceiver docs) is too short
    // for a cold serverless backend. WorkManager persists across Doze/reboot
    // and retries with exponential backoff + CONNECTED constraint.
    implementation("androidx.work:work-runtime-ktx:2.9.0")
}