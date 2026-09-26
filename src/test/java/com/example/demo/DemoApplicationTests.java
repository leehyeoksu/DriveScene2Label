package com.example.demo;

import com.example.demo.nuscenes.importer.NuscenesImporter;
import com.example.demo.nuscenes.repository.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties={
 "spring.datasource.url=${TEST_DB_URL:jdbc:postgresql://localhost:55432/drivescene_test}",
 "spring.datasource.username=${TEST_DB_USERNAME:drivescene}",
 "spring.datasource.password=${TEST_DB_PASSWORD:}",
 "nuscenes.import.enabled=false"
})
@AutoConfigureMockMvc
@Transactional
class DemoApplicationTests {
 // Only synthetic JSON fixtures are versioned. Generate tiny placeholder media in a temp folder.
 private static final java.nio.file.Path FIXTURE_ROOT = createFixtureRoot();
 @org.springframework.test.context.DynamicPropertySource
 static void fixtureProperties(org.springframework.test.context.DynamicPropertyRegistry registry) {
  registry.add("nuscenes.root", () -> FIXTURE_ROOT.toString());
 }
 private static java.nio.file.Path createFixtureRoot() {
  try {
   var root = java.nio.file.Files.createTempDirectory("drivescene-test-");
   var source = java.nio.file.Path.of(DemoApplicationTests.class.getResource("/nuscenes/v1.0-mini").toURI());
   var metadata = java.nio.file.Files.createDirectories(root.resolve("v1.0-mini"));
   try (var paths = java.nio.file.Files.list(source)) {
    for (var path : paths.filter(p -> p.toString().endsWith(".json")).toList()) {
     java.nio.file.Files.copy(path, metadata.resolve(path.getFileName()));
    }
   }
   var mapper = new tools.jackson.databind.ObjectMapper();
   for (String table : java.util.List.of("sample_data", "map")) {
    for (var row : mapper.readTree(java.nio.file.Files.readAllBytes(metadata.resolve(table + ".json")))) {
     var file = root.resolve(row.path("filename").asText()).normalize();
     if (!file.startsWith(root)) throw new IllegalStateException("Invalid test fixture path");
     java.nio.file.Files.createDirectories(file.getParent());
     java.nio.file.Files.writeString(file, table.equals("map") ? "synthetic-map" : "synthetic-fixture");
    }
   }
   return root;
  } catch (Exception e) { throw new IllegalStateException("Cannot create synthetic fixtures", e); }
 }
 @org.junit.jupiter.api.AfterAll
 static void cleanupFixtureRoot() throws Exception {
  try (var paths = java.nio.file.Files.walk(FIXTURE_ROOT)) {
   for (var path : paths.sorted(java.util.Comparator.reverseOrder()).toList()) java.nio.file.Files.delete(path);
  }
 }

 @Autowired NuscenesImporter importer;
 @Autowired SceneRepository scenes;
 @Autowired SampleRepository samples;
 @Autowired SampleDataRepository sensorFiles;
 @Autowired JdbcClient jdbc;
 @Autowired MockMvc mvc;

 @Test void importIsIdempotentAndPreservesRelationships() throws Exception {
  var first=importer.importDataset("v1.0-mini");
  var second=importer.importDataset("v1.0-mini");
  assertThat(second.datasetId()).isEqualTo(first.datasetId());
  assertThat(first.skippedMapLogLinks()).isEqualTo(1);
  assertThat(jdbc.sql("SELECT count(*) FROM sample_data WHERE dataset_id=:id").param("id",first.datasetId()).query(Long.class).single()).isEqualTo(7);
  var scene=scenes.findByDatasetId(first.datasetId()).getFirst();
  var sample=samples.listByScene(first.datasetId(),scene.token(),100,0).getFirst();
  assertThat(sample.prevToken()).isNull();
  assertThat(sample.timestampUs()).isEqualTo(1532402927647951L);
  assertThat(sensorFiles.listBySample(first.datasetId(),sample.token(),true)).hasSize(7);
  assertThat(jdbc.sql("SELECT count(*) FROM annotation_attribute WHERE dataset_id=:id").param("id",first.datasetId()).query(Long.class).single()).isEqualTo(1);
 }
 @Test void catalogReturnsCameraLidarMapAndGtAndServesFile() throws Exception {
  long dataset=importer.importDataset("v1.0-mini").datasetId();
  var scene=scenes.findByDatasetId(dataset).getFirst();
  var sample=samples.listByScene(dataset,scene.token(),100,0).getFirst();
  mvc.perform(get("/api/datasets/{id}/stats",dataset)).andExpect(status().isOk()).andExpect(jsonPath("$.sensorFiles").value(7));
  mvc.perform(get("/api/samples/{id}",sample.id())).andExpect(status().isOk())
   .andExpect(jsonPath("$.sensorFiles.length()").value(7)).andExpect(jsonPath("$.maps[0].location").value("test-location"));
  mvc.perform(get("/api/samples/{id}/annotations",sample.id())).andExpect(status().isOk()).andExpect(jsonPath("$[0].sizeW").value(2.0));
  long file=jdbc.sql("SELECT id FROM sample_data WHERE dataset_id=:id AND token='file-0'").param("id",dataset).query(Long.class).single();
  mvc.perform(get("/api/sensor-files/{id}/content",file)).andExpect(status().isOk()).andExpect(content().contentType("image/jpeg")).andExpect(content().string("synthetic-fixture"));
  mvc.perform(get("/api/sensor-files/{id}/calibration",file)).andExpect(status().isOk()).andExpect(jsonPath("$.intrinsic00").value(1000.0));
  mvc.perform(get("/api/sensor-files/{id}/pose",file)).andExpect(status().isOk()).andExpect(jsonPath("$.translationX").value(100.0));
 }
 @Test void missingRecordsAndInvalidPaginationReturnClientErrors() throws Exception {
  mvc.perform(get("/api/samples/9223372036854775807")).andExpect(status().isNotFound());
  mvc.perform(get("/api/sensor-files/9223372036854775807/content")).andExpect(status().isNotFound());
  mvc.perform(get("/api/scenes/1/samples?limit=0")).andExpect(status().isBadRequest());
 }
 @Test void modifiedDatasetIsRejectedInsteadOfMixingMetadata() throws Exception {
  long dataset=importer.importDataset("v1.0-mini").datasetId();
  jdbc.sql("UPDATE dataset SET source_checksum='different' WHERE id=:id").param("id",dataset).update();
  assertThatThrownBy(()->importer.importDataset("v1.0-mini")).isInstanceOf(IllegalStateException.class).hasMessageContaining("different metadata");
 }
}
