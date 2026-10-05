package com.example.demo;
import com.example.demo.nuscenes.client.AutoLabelClient;
import com.example.demo.nuscenes.dto.AutoLabelDtos.*;
import com.example.demo.nuscenes.service.*;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.*;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.ObjectMapper;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties={"auto-label.worker.enabled=false","recording.worker.enabled=false","auto-label.dataset-version=v1.0-mini",
 "spring.datasource.url=${TEST_DB_URL:jdbc:postgresql://localhost:55432/drivescene_test}",
 "spring.datasource.username=${TEST_DB_USERNAME:drivescene}","spring.datasource.password=${TEST_DB_PASSWORD:}","nuscenes.import.enabled=false"})
@AutoConfigureMockMvc
class AutoLabelTests {
 static final ObjectMapper JSON=new ObjectMapper();
 static final AtomicReference<String> MODE=new AtomicReference<>("ok");
 static final HttpServer AI=start();
 static HttpServer start() {
  try {
   var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
   server.createContext("/auto-label",exchange->{
    var input=JSON.readTree(exchange.getRequestBody().readAllBytes());
    var box=new Box("sample-a",List.of(1.,2.,3.),List.of(2.,4.,1.),List.of(1.,0.,0.,0.),List.of(0.,0.),"car",1.,"");
    Map<String,List<Box>> results=MODE.get().equals("bad")?Map.of("sample-a",List.of(box)):Map.of("sample-a",List.of(box,box),"sample-empty",List.of());
    String body=JSON.writeValueAsString(new AiResponse(UUID.randomUUID(),input.path("scene_name").asText(),8,input.path("job_id").asLong(),
     UUID.fromString(input.path("execution_token").asText()),"8class","mini_train","WORLD","VESPA_CONSTANT",Map.of("use_lidar",true),results,"run/result.json","a".repeat(64)));
    if(MODE.get().equals("fail")) body="{\"detail\":\"VESPA failed\"}";
    byte[] bytes=body.getBytes(StandardCharsets.UTF_8);exchange.getResponseHeaders().set("Content-Type","application/json");
    exchange.sendResponseHeaders(MODE.get().equals("fail")?502:200,bytes.length);
    try(var output=exchange.getResponseBody()) { output.write(bytes); }
   }); server.start();return server;
  } catch(Exception e) { throw new IllegalStateException(e); }
 }
 @DynamicPropertySource static void properties(DynamicPropertyRegistry r) { r.add("ai-server.base-url",()->"http://127.0.0.1:"+AI.getAddress().getPort()); }
 @AfterAll static void shutdown() { AI.stop(0); }
 @Autowired MockMvc mvc; @Autowired JdbcClient jdbc; @Autowired AutoLabelService jobs; @Autowired AutoLabelClient client;
 long dataset;
 @BeforeEach void seed() {
  MODE.set("ok");
  dataset=jdbc.sql("INSERT INTO dataset(name,version,storage_key,root_relative_path,source_checksum) VALUES(:n,'v1.0-mini','local','.','test') RETURNING id").param("n","auto-test-"+UUID.randomUUID()).query(Long.class).single();
  jdbc.sql("INSERT INTO capture_log(dataset_id,token,logfile,location,date_captured,vehicle,raw_payload) VALUES(:d,'log','x','x','x','x','{}')").param("d",dataset).update();
  jdbc.sql("INSERT INTO scene(dataset_id,token,log_token,name,description,nbr_samples,first_sample_token,last_sample_token,raw_payload) VALUES(:d,'scene-token','log','scene-0061','test',2,'sample-a','sample-empty','{}')").param("d",dataset).update();
  for(String token:List.of("sample-a","sample-empty")) jdbc.sql("INSERT INTO sample(dataset_id,token,scene_token,timestamp_us,raw_payload) VALUES(:d,:t,'scene-token',1,'{}')").param("d",dataset).param("t",token).update();
 }
 @AfterEach void cleanup() {
  jdbc.sql("DROP TRIGGER IF EXISTS test_reject_completed ON auto_label_job").update();
  jdbc.sql("DROP FUNCTION IF EXISTS test_reject_completed()").update();
  jdbc.sql("DELETE FROM auto_label_job WHERE dataset_id=:d").param("d",dataset).update();
  jdbc.sql("DELETE FROM sample WHERE dataset_id=:d").param("d",dataset).update();
  jdbc.sql("DELETE FROM scene WHERE dataset_id=:d").param("d",dataset).update();
  jdbc.sql("DELETE FROM capture_log WHERE dataset_id=:d").param("d",dataset).update();
  jdbc.sql("DELETE FROM dataset WHERE id=:d").param("d",dataset).update();
 }
 long create(String key) throws Exception {
  var response=mvc.perform(post("/api/auto-label/jobs").header("Idempotency-Key",key).contentType("application/json")
   .content("{\"sceneToken\":\"scene-token\",\"classMode\":8,\"datasetId\":"+dataset+"}"))
   .andExpect(status().isAccepted()).andReturn().getResponse().getContentAsString();
  return JSON.readTree(response).path("jobId").asLong();
 }
 long boxes(long job) { return jdbc.sql("SELECT count(*) FROM predicted_annotation WHERE job_id=:j").param("j",job).query(Long.class).single(); }
 @Test void pendingThenHttpResultCompletedAndEmptySample() throws Exception {
  long gt=jdbc.sql("SELECT count(*) FROM gt_annotation").query(Long.class).single();
  long job=create("success"); assertThat(jobs.status(job).status()).isEqualTo("PENDING");
  long scene=jdbc.sql("SELECT id FROM scene WHERE dataset_id=:d AND token='scene-token'").param("d",dataset).query(Long.class).single();
  mvc.perform(get("/api/auto-label/jobs/{id}",job)).andExpect(status().isOk()).andExpect(jsonPath("$.jobId").value(job)).andExpect(jsonPath("$.datasetId").value(dataset))
   .andExpect(jsonPath("$.status").value("PENDING")).andExpect(jsonPath("$.errorMessage").isEmpty()).andExpect(jsonPath("$.createdAt").isNotEmpty())
   .andExpect(jsonPath("$.startedAt").isEmpty()).andExpect(jsonPath("$.completedAt").isEmpty())
   .andExpect(jsonPath("$.sceneToken").value("scene-token")).andExpect(jsonPath("$.sceneId").value(scene)).andExpect(jsonPath("$.sceneName").value("scene-0061"))
   .andExpect(jsonPath("$.classMode").value(8)).andExpect(jsonPath("$.mappingName").value("8class"));
  mvc.perform(get("/api/auto-label/jobs/{id}/results",job)).andExpect(status().isConflict());
  new AutoLabelWorker(jobs,client).runNextJob();
  mvc.perform(get("/api/auto-label/jobs/{id}",job)).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("COMPLETED"))
   .andExpect(jsonPath("$.completedAt").isNotEmpty()).andExpect(jsonPath("$.sceneToken").value("scene-token")).andExpect(jsonPath("$.sceneId").value(scene)).andExpect(jsonPath("$.classMode").value(8));
  mvc.perform(get("/api/auto-label/jobs/{id}/results",job)).andExpect(status().isOk())
   .andExpect(jsonPath("$.boxes.length()").value(2)).andExpect(jsonPath("$.sampleTokens.length()").value(2))
   .andExpect(jsonPath("$.coordinateFrame").value("WORLD")).andExpect(jsonPath("$.artifacts.length()").value(1));
  assertThat(boxes(job)).isEqualTo(2);
  assertThat(jdbc.sql("SELECT count(*) FROM auto_label_job_sample WHERE job_id=:j AND result_received_at IS NOT NULL").param("j",job).query(Long.class).single()).isEqualTo(2);
  assertThat(jdbc.sql("SELECT count(*) FROM auto_label_artifact WHERE job_id=:j").param("j",job).query(Long.class).single()).isEqualTo(1);
  assertThat(jdbc.sql("SELECT count(*) FROM predicted_annotation p JOIN sample s ON s.dataset_id=p.dataset_id AND s.token=p.sample_token WHERE job_id=:j").param("j",job).query(Long.class).single()).isEqualTo(2);
  assertThat(jdbc.sql("SELECT count(*) FROM gt_annotation").query(Long.class).single()).isEqualTo(gt);
 }
 @Test void idempotentCreationAndConflict() throws Exception {
  long job=create("same");assertThat(create("same")).isEqualTo(job);
  mvc.perform(post("/api/auto-label/jobs").header("Idempotency-Key","same").contentType("application/json")
   .content("{\"sceneToken\":\"scene-token\",\"classMode\":3,\"datasetId\":"+dataset+"}")).andExpect(status().isConflict());
 }
 @Test void aiFailureAndInvalidCoverageFailWithoutBoxes() throws Exception {
  for(String mode:List.of("fail","bad")) {
   MODE.set(mode);long job=create(mode);new AutoLabelWorker(jobs,client).runNextJob();
   assertThat(jobs.status(job).status()).isEqualTo("FAILED");assertThat(jobs.status(job).errorMessage()).isNotBlank();assertThat(boxes(job)).isZero();
  }
 }
 @Test void terminalUpdateFailureRollsBackAllResults() throws Exception {
  long job=create("rollback");
  jdbc.sql("CREATE FUNCTION test_reject_completed() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN IF NEW.status = ''COMPLETED'' THEN RAISE EXCEPTION ''test completion failure''; END IF; RETURN NEW; END;'").update();
  jdbc.sql("CREATE TRIGGER test_reject_completed BEFORE UPDATE ON auto_label_job FOR EACH ROW EXECUTE FUNCTION test_reject_completed()").update();
  new AutoLabelWorker(jobs,client).runNextJob();
  assertThat(jobs.status(job).status()).isEqualTo("FAILED"); assertThat(boxes(job)).isZero();
  assertThat(jdbc.sql("SELECT count(*) FROM auto_label_artifact WHERE job_id=:j").param("j",job).query(Long.class).single()).isZero();
  assertThat(jdbc.sql("SELECT count(*) FROM auto_label_job_sample WHERE job_id=:j AND result_received_at IS NOT NULL").param("j",job).query(Long.class).single()).isZero();
 }
}
