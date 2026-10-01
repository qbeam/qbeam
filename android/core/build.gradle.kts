plugins {
    kotlin("jvm") version "2.1.20"
}

kotlin { jvmToolchain(17) }

dependencies {
    testImplementation(kotlin("test"))
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.4")
    testImplementation("org.json:json:20240303")
}

tasks.test {
    useJUnitPlatform()
    systemProperty("qbeam.vectors", rootProject.file("../protocol/test-vectors/v3.json").absolutePath)
}
