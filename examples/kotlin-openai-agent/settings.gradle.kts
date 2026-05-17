// Wires the example into a Gradle composite build that pulls the Kotlin SDK
// from ../../sdks/kotlin/. Without this file Gradle has no way to resolve
// the `implementation(project(":"))` line in build.gradle.kts.
//
// This file is missing from the repo as of HEAD — added here to validate the
// example actually builds. Worth checking in upstream.
rootProject.name = "kotlin-openai-agent"

includeBuild("../../sdks/kotlin") {
    dependencySubstitution {
        substitute(module("com.getbindu:bindu-sdk")).using(project(":"))
    }
}
