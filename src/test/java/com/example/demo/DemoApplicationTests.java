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
 "ingestion.worker.enabled=false",
 "auto-label.worker.enabled=false","recording.worker.enabled=false",
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
  mvc.perform(get("/api/samples/{id}/annotations",sample.id())).andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(1))
   .andExpect(jsonPath("$[0].sizeW").value(2.0)).andExpect(jsonPath("$[0].sizeL").value(4.0)).andExpect(jsonPath("$[0].token").value("box-1"))
   .andExpect(jsonPath("$[0].instanceToken").value("instance-1")).andExpect(jsonPath("$[0].numLidarPts").value(10)).andExpect(jsonPath("$[0].datasetId").value(dataset))
   .andExpect(jsonPath("$[0].categoryToken").value("category-1")).andExpect(jsonPath("$[0].categoryName").value("vehicle.car"));
  long file=jdbc.sql("SELECT id FROM sample_data WHERE dataset_id=:id AND token='file-0'").param("id",dataset).query(Long.class).single();
  mvc.perform(get("/api/sensor-files/{id}/content",file)).andExpect(status().isOk()).andExpect(content().contentType("image/jpeg")).andExpect(content().string("synthetic-fixture"));
  mvc.perform(get("/api/sensor-files/{id}/calibration",file)).andExpect(status().isOk()).andExpect(jsonPath("$.intrinsic00").value(1000.0));
  mvc.perform(get("/api/sensor-files/{id}/pose",file)).andExpect(status().isOk()).andExpect(jsonPath("$.translationX").value(100.0));
 }
 @Test void gtCategoryIsResolvedWithinEachDataset() throws Exception {
  long first=importer.importDataset("v1.0-mini").datasetId();
  // Second dataset reuses every token but names category-1 differently; a JOIN without dataset_id would mix them.
  long second=jdbc.sql("INSERT INTO dataset(name,version,storage_key,root_relative_path,source_checksum) VALUES('category-isolation','v1.0-mini','local','.','test') RETURNING id").query(Long.class).single();
  jdbc.sql("INSERT INTO capture_log(dataset_id,token,logfile,location,date_captured,vehicle,raw_payload) VALUES(:d,'log-1','x','x','x','x','{}')").param("d",second).update();
  jdbc.sql("INSERT INTO scene(dataset_id,token,log_token,name,description,nbr_samples,first_sample_token,last_sample_token,raw_payload) VALUES(:d,'scene-1','log-1','scene-test','x',1,'sample-1','sample-1','{}')").param("d",second).update();
  jdbc.sql("INSERT INTO sample(dataset_id,token,scene_token,timestamp_us,raw_payload) VALUES(:d,'sample-1','scene-1',1,'{}')").param("d",second).update();
  jdbc.sql("INSERT INTO category(dataset_id,token,name,description,raw_payload) VALUES(:d,'category-1','human.pedestrian.adult','x','{}')").param("d",second).update();
  jdbc.sql("INSERT INTO object_instance(dataset_id,token,category_token,nbr_annotations,first_annotation_token,last_annotation_token,raw_payload) VALUES(:d,'instance-1','category-1',1,'box-1','box-1','{}')").param("d",second).update();
  jdbc.sql("""
   INSERT INTO gt_annotation(dataset_id,token,sample_token,instance_token,center_x,center_y,center_z,size_w,size_l,size_h,rotation_w,rotation_x,rotation_y,rotation_z,num_lidar_pts,num_radar_pts,raw_payload)
   VALUES(:d,'box-1','sample-1','instance-1',0,0,0,1,1,1,1,0,0,0,0,0,'{}')""").param("d",second).update();
  for(long dataset:new long[]{first,second}) {
   long sample=jdbc.sql("SELECT id FROM sample WHERE dataset_id=:d AND token='sample-1'").param("d",dataset).query(Long.class).single();
   mvc.perform(get("/api/samples/{id}/annotations",sample)).andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(1))
    .andExpect(jsonPath("$[0].datasetId").value(dataset)).andExpect(jsonPath("$[0].categoryToken").value("category-1"))
    .andExpect(jsonPath("$[0].categoryName").value(dataset==first?"vehicle.car":"human.pedestrian.adult"));
  }
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
 @Test void similarImagesAreOrderedByCosineDistance() throws Exception {
  long dataset=importer.importDataset("v1.0-mini").datasetId();
  var tokens=jdbc.sql("SELECT token FROM sample_data WHERE dataset_id=:id ORDER BY token").param("id",dataset).query(String.class).list();
  // Synthetic 768-d vectors: file 0 and 1 point almost the same way, file 2 is orthogonal, file 3 has no embedding.
  storeEmbedding(dataset,tokens.get(0),1.0,0.0);
  storeEmbedding(dataset,tokens.get(1),0.9,0.1);
  storeEmbedding(dataset,tokens.get(2),0.0,1.0);
  mvc.perform(get("/api/sensor-files/{id}/similar",sensorFileId(dataset,tokens.get(0)))).andExpect(status().isOk())
   .andExpect(jsonPath("$.length()").value(2))
   .andExpect(jsonPath("$[0].token").value(tokens.get(1))).andExpect(jsonPath("$[1].token").value(tokens.get(2)));
  mvc.perform(get("/api/sensor-files/{id}/similar?excludeSameScene=true",sensorFileId(dataset,tokens.get(0))))
   .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(0));
  mvc.perform(get("/api/datasets/{id}/embeddings",dataset)).andExpect(status().isOk())
   .andExpect(jsonPath("$.length()").value(1)).andExpect(jsonPath("$[0].modelName").value(MODEL_NAME))
   .andExpect(jsonPath("$[0].preprocess").value(PREPROCESS)).andExpect(jsonPath("$[0].images").value(3));
  // A different preprocess of the same model is a separate vector space: not used as a source or compared.
  storeEmbedding(dataset,tokens.get(3),1.0,0.0,"other-preprocess");
  mvc.perform(get("/api/sensor-files/{id}/similar?preprocess=other-preprocess",sensorFileId(dataset,tokens.get(3))))
   .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(0));
  mvc.perform(get("/api/sensor-files/{id}/similar",sensorFileId(dataset,tokens.get(3)))).andExpect(status().isNotFound());
  mvc.perform(get("/api/sensor-files/{id}/similar?limit=0",sensorFileId(dataset,tokens.get(0)))).andExpect(status().isBadRequest());
 }
 private static final String MODEL_NAME="ViT-L-14-quickgelu/openai";
 private static final String PREPROCESS="lr-square-crop-mean";
 private void storeEmbedding(long dataset, String token, double x, double y) { storeEmbedding(dataset,token,x,y,PREPROCESS); }
 private void storeEmbedding(long dataset, String token, double x, double y, String preprocess) {
  var v=new StringBuilder("[").append(x).append(',').append(y);
  for(int i=2;i<768;i++) v.append(",0");
  jdbc.sql("INSERT INTO image_embedding(dataset_id, sample_data_token, model_name, preprocess, embedding) VALUES (:d,:t,:m,:p,CAST(:v AS vector))")
   .param("d",dataset).param("t",token).param("m",MODEL_NAME).param("p",preprocess).param("v",v.append(']').toString()).update();
 }
 private long sensorFileId(long dataset, String token) {
  return jdbc.sql("SELECT id FROM sample_data WHERE dataset_id=:d AND token=:t").param("d",dataset).param("t",token).query(Long.class).single();
 }
}
