package com.example.demo;
import com.example.demo.nuscenes.service.DatasetIngestionService;
import com.example.demo.nuscenes.storage.DatasetFiles;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.*;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties={"auto-label.worker.enabled=false","recording.worker.enabled=false","ingestion.worker.enabled=false",
 "nuscenes.import.enabled=false","spring.datasource.url=${TEST_DB_URL:jdbc:postgresql://localhost:55432/drivescene_test}",
 "spring.datasource.username=${TEST_DB_USERNAME:drivescene}","spring.datasource.password=${TEST_DB_PASSWORD:}"})
@AutoConfigureMockMvc
@Transactional
class DatasetIngestionTests {
 static final Path ROOT; static final HttpServer AI; static final AtomicInteger CALLS=new AtomicInteger();
 static volatile boolean FAIL;
 static final List<String> REQUESTS=new java.util.concurrent.CopyOnWriteArrayList<>();
 static {
  try {
   ROOT=Files.createTempDirectory("ingestion-test-");
   AI=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
   AI.createContext("/embedding/image",e->{
    String body=new String(e.getRequestBody().readAllBytes(),java.nio.charset.StandardCharsets.UTF_8); REQUESTS.add(body);
    int call=CALLS.incrementAndGet();
    if(FAIL && call==2) { FakeAi.send(e,503,"{}"); return; }
    FakeAi.send(e,200,"{\"model_name\":\"ViT-L-14-quickgelu/openai\",\"dimension\":768,\"preprocess\":\"lr-square-crop-mean\",\"embedding\":[1"+",0".repeat(767)+"]}");
   }); AI.start();
  } catch(Exception e) { throw new ExceptionInInitializerError(e); }
 }
 @DynamicPropertySource static void properties(DynamicPropertyRegistry r) {
  r.add("uploads.root",()->ROOT.toString()); r.add("ai-server.base-url",()->"http://127.0.0.1:"+AI.getAddress().getPort());
 }
 @AfterAll static void cleanup() throws Exception {
  AI.stop(0);
  try(var paths=Files.walk(ROOT)) { for(var path:paths.sorted(Comparator.reverseOrder()).toList()) Files.delete(path); }
 }
 @BeforeEach void reset() { CALLS.set(0); FAIL=false; REQUESTS.clear(); }
 @Autowired DatasetIngestionService service; @Autowired JdbcClient jdbc; @Autowired MockMvc mvc; @Autowired DatasetFiles files;
 DatasetIngestionService.Job uploaded() throws Exception {
  var j=service.create("Uploaded mini","v1.0-mini","SYNTHETIC");
  Path metadata=Path.of(getClass().getResource("/nuscenes/v1.0-mini").toURI());
  int count=0;
  try(var paths=Files.list(metadata)) {
   for(var path:paths.filter(x->x.toString().endsWith(".json")).toList()) {
    service.upload(j.id(),"v1.0-mini/"+path.getFileName(),new MockMultipartFile("file",Files.readAllBytes(path))); count++;
   }
  }
  var json=new ObjectMapper();
  for(String table:List.of("sample_data","map")) for(var row:json.readTree(Files.readAllBytes(metadata.resolve(table+".json")))) {
   service.upload(j.id(),row.path("filename").asText(),new MockMultipartFile("file","original-media".getBytes())); count++;
  }
  service.finish(j.id(),count); return service.get(j.id());
 }
 @Test void uploadImportsIndexesAndServesOriginalThenSkipsExistingVectors() throws Exception {
  var job=uploaded(); service.runNext(); var done=service.get(job.id());
  assertThat(done.status()).isEqualTo("COMPLETED");
  assertThat(done.completedImages()).isEqualTo(6); assertThat(done.totalImages()).isEqualTo(6);
  assertThat(jdbc.sql("SELECT count(*) FROM image_embedding WHERE dataset_id=:id").param("id",done.datasetId()).query(Long.class).single()).isEqualTo(6);
  assertThat(REQUESTS).allMatch(body->body.contains("__uploads__/"+job.id()+"/"));
  long file=jdbc.sql("SELECT min(id) FROM sample_data WHERE dataset_id=:d").param("d",done.datasetId()).query(Long.class).single();
  mvc.perform(get("/api/sensor-files/{id}/content",file)).andExpect(status().isOk()).andExpect(content().bytes("original-media".getBytes()));
  var next=service.index(done.datasetId()); assertThat(service.index(done.datasetId()).id()).isEqualTo(next.id());
  service.runNext(); assertThat(CALLS.get()).isEqualTo(6);
  assertThat(service.get(next.id()).status()).isEqualTo("COMPLETED");
 }
 @Test void failureRetainsVectorsAndRetryResumesOnlyMissingImages() throws Exception {
  var j=uploaded(); FAIL=true; service.runNext();
  var failed=service.get(j.id()); assertThat(failed.status()).isEqualTo("FAILED"); assertThat(failed.completedImages()).isEqualTo(1);
  FAIL=false; service.retry(j.id()); service.runNext();
  assertThat(service.get(j.id()).completedImages()).isEqualTo(6); assertThat(CALLS.get()).isEqualTo(7);
 }
 @Test void incompleteMetadataRollsBackCatalog() throws Exception {
  var j=service.create("Broken","v1.0-mini","UNKNOWN");
  for(String table:List.of("scene","sample","sample_data")) service.upload(j.id(),"v1.0-mini/"+table+".json",new MockMultipartFile("file","[]".getBytes()));
  service.finish(j.id(),3); service.runNext();
  assertThat(service.get(j.id()).status()).isEqualTo("FAILED"); assertThat(service.get(j.id()).datasetId()).isNull();
  assertThat(jdbc.sql("SELECT count(*) FROM dataset WHERE root_relative_path=:p").param("p",j.id().toString()).query(Long.class).single()).isZero();
 }
 @Test void pathsAndCompletedUploadsAreProtected() throws Exception {
  var j=service.create("Path test","v1.0-mini","UNKNOWN");
  for(String path:List.of("../outside","/tmp/out","a/../../out","a\\out","C:/out")) {
   mvc.perform(multipart("/api/dataset-ingestions/{id}/files",j.id()).file(new MockMultipartFile("file","x".getBytes())).param("path",path)).andExpect(status().isBadRequest());
  }
  service.upload(j.id(),"samples/a.jpg",new MockMultipartFile("file","first".getBytes()));
  service.upload(j.id(),"samples/a.jpg",new MockMultipartFile("file","replacement".getBytes()));
  assertThat(service.get(j.id()).uploadedFiles()).isEqualTo(1);
  assertThat(service.get(j.id()).uploadedBytes()).isEqualTo(11);
  assertThatThrownBy(()->service.finish(j.id(),2)).isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
  var queued=uploaded();
  assertThatThrownBy(()->service.upload(queued.id(),"samples/new.jpg",new MockMultipartFile("file","x".getBytes()))).isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
 }
}
