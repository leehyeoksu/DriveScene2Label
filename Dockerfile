# Integration tests require a separate PostgreSQL DB; build the executable JAR here.
FROM eclipse-temurin:21-jdk-jammy AS build
WORKDIR /workspace
COPY gradlew build.gradle settings.gradle ./
COPY gradle/ gradle/
COPY src/main/ src/main/
RUN bash gradlew --no-daemon bootJar

FROM eclipse-temurin:21-jre-jammy AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
RUN groupadd --gid 10001 app && useradd --uid 10001 --gid app --no-create-home app
COPY --from=build --chown=app:app /workspace/build/libs/*.jar /app/app.jar
USER app
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
