package com.example.demo;
import com.example.demo.nuscenes.importer.NuscenesImporter;
import com.example.demo.nuscenes.service.SystemStatusService;
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
import org.springframework.test.context.*;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** GET /api/system/status: provenance, instance id, per-feature readiness, older AI adapter, read-only refresh (IT-02/03/04). */
@SpringBootTest(properties={"auto-label.worker.enabled=false","recording.worker.enabled=false","system-status.check-workers=false",
 "spring.datasource.url=${TEST_DB_URL:jdbc:postgresql://localhost:55432/drivescene_test}",
 "spring.datasource.username=${TEST_DB_USERNAME:drivescene}","spring.datasource.password=${TEST_DB_PASSWORD:}",
 "nuscenes.import.enabled=false","nuscenes.data-origin=SYNTHETIC","auto-label.dataset-version=v1.0-mini","system-status.ai-cache=0s"})
@AutoConfigureMockMvc
@Transactional
class SystemStatusTests {
 static final ObjectMapper JSON=new ObjectMapper();
 static final Path ROOT=fixtureRoot(), RECORDINGS=ROOT.resolve("recordings");
 /** Any AI call other than /capabilities and /health (e.g. /auto-label, /recordings, /embedding) is counted here. */
 static final AtomicInteger UNEXPECTED=new AtomicInteger();
 static final HttpServer AI=start();
 static HttpServer start() {
  try {
   var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
   FakeAi.install(server);
   server.createContext("/",ex->{ UNEXPECTED.incrementAndGet(); FakeAi.send(ex,500,"{}"); });
   server.start(); return server;
  } catch(Exception e) { throw new IllegalStateException(e); }
 }
 static Path fixtureRoot() {
  try {
   var root=Files.createTempDirectory("ds2l-status-");
   var source=Path.of(SystemStatusTests.class.getResource("/nuscenes/v1.0-mini").toURI());
   var meta=Files.createDirectories(root.resolve("v1.0-mini"));
   try(var paths=Files.list(source)) { for(var p:paths.filter(p->p.toString().endsWith(".json")).toList()) Files.copy(p,meta.resolve(p.getFileName())); }
   for(String table:List.of("sample_data","map")) for(var row:JSON.readTree(Files.readAllBytes(meta.resolve(table+".json")))) {
    var file=root.resolve(row.path("filename").asString()); Files.createDirectories(file.getParent()); Files.writeString(file,"synthetic");
   }
   Files.createDirectories(root.resolve("recordings"));
   return root;
  } catch(Exception e) { throw new IllegalStateException(e); }
 }
 @DynamicPropertySource static void props(DynamicPropertyRegistry r) {
  r.add("nuscenes.root",ROOT::toString); r.add("recording.root",RECORDINGS::toString);
  r.add("ai-server.base-url",()->"http://127.0.0.1:"+AI.getAddress().getPort());
 }
 @AfterAll static void stop() throws Exception {
  AI.stop(0);
  try(var paths=Files.walk(ROOT)) { for(var p:paths.sorted(Comparator.reverseOrder()).toList()) Files.deleteIfExists(p); }
 }
 @Autowired MockMvc mvc; @Autowired JdbcClient jdbc; @Autowired NuscenesImporter importer; @Autowired SystemStatusService status;
 @BeforeEach void reset() { FakeAi.CAPS.set("ready"); status.clearCache(); UNEXPECTED.set(0); }

 @Test void withoutDatasetAndStableInstanceId() throws Exception {
  String instance=jdbc.sql("SELECT CAST(instance_id AS text) FROM system_instance").query(String.class).single();
  for(int i=0;i<2;i++) mvc.perform(get("/api/system/status")).andExpect(status().isOk())
   .andExpect(jsonPath("$.schemaVersion").value(1)).andExpect(jsonPath("$.instanceId").value(instance)).andExpect(jsonPath("$.dataset").isEmpty())
   .andExpect(jsonPath("$.capabilities.catalog.state").value("READY")).andExpect(jsonPath("$.capabilities.media.reasonCode").value("DATASET_NOT_SELECTED"))
   .andExpect(jsonPath("$.capabilities.vespa.executor").value("local")).andExpect(jsonPath("$.capabilities.catalog.expiresAt").isNotEmpty());
  mvc.perform(get("/api/system/status?datasetId=0")).andExpect(status().isBadRequest());
  mvc.perform(get("/api/system/status?datasetId="+Long.MAX_VALUE)).andExpect(status().isNotFound());
 }

 @Test void provenanceIsExplicitAndBoundToTheChecksum() throws Exception {
  long d=importer.importDataset("v1.0-mini").datasetId();
  String checksum=jdbc.sql("SELECT source_checksum FROM dataset WHERE id=:d").param("d",d).query(String.class).single();
  String url="/api/system/status?datasetId="+d;
  mvc.perform(get(url)).andExpect(jsonPath("$.dataset.origin").value("SYNTHETIC")).andExpect(jsonPath("$.dataset.metadataChecksum").value(checksum))
   .andExpect(jsonPath("$.dataset.mediaValidation").value("PARTIAL"))
   .andExpect(jsonPath("$.capabilities.vespa.state").value("UNAVAILABLE")).andExpect(jsonPath("$.capabilities.vespa.reasonCode").value("SYNTHETIC_DATASET"))
   .andExpect(jsonPath("$.capabilities.vespa.canExecute").value(false))
   .andExpect(jsonPath("$.capabilities.media.state").value("CONFIGURED")).andExpect(jsonPath("$.capabilities.media.canExecute").value(true))
   .andExpect(jsonPath("$.capabilities.media.reasonCode").value("MEDIA_NOT_FULLY_VALIDATED"))
   .andExpect(jsonPath("$.capabilities.search.reasonCode").value("EMBEDDINGS_NOT_READY"))
   .andExpect(jsonPath("$.capabilities.recording.state").value("READY")).andExpect(jsonPath("$.capabilities.recording.canExecute").value(true));
  // A provenance row recorded for other metadata does not apply: origin falls back to UNKNOWN (never guessed).
  jdbc.sql("UPDATE dataset_provenance SET metadata_checksum=:c WHERE dataset_id=:d").param("c","0".repeat(64)).param("d",d).update();
  mvc.perform(get(url)).andExpect(jsonPath("$.dataset.origin").value("UNKNOWN")).andExpect(jsonPath("$.dataset.mediaValidation").value("NOT_CHECKED"))
   .andExpect(jsonPath("$.capabilities.vespa.state").value("READY")).andExpect(jsonPath("$.capabilities.vespa.canExecute").value(true));
  // one missing camera file: media stays usable but says so
  Path cam=ROOT.resolve("samples/CAM_FRONT/fixture.jpg"); byte[] bytes=Files.readAllBytes(cam); Files.delete(cam);
  try { mvc.perform(get(url)).andExpect(jsonPath("$.capabilities.media.reasonCode").value("MEDIA_FILES_MISSING")).andExpect(jsonPath("$.capabilities.media.canExecute").value(true)); }
  finally { Files.write(cam,bytes); }
  // search becomes READY only with embeddings of the configured model/preprocess
  var v=new StringBuilder("[1"); for(int i=1;i<768;i++) v.append(",0");
  jdbc.sql("INSERT INTO image_embedding(dataset_id,sample_data_token,model_name,preprocess,embedding) VALUES(:d,'file-0','ViT-L-14-quickgelu/openai','lr-square-crop-mean',CAST(:v AS vector))")
   .param("d",d).param("v",v.append(']').toString()).update();
  mvc.perform(get(url)).andExpect(jsonPath("$.capabilities.search.state").value("READY")).andExpect(jsonPath("$.capabilities.search.canExecute").value(true));
  assertThat(UNEXPECTED.get()).isZero();
 }

 @Test void olderOrBrokenAiNeverLooksReady() throws Exception {
  long d=importer.importDataset("v1.0-mini").datasetId();
  jdbc.sql("UPDATE dataset_provenance SET origin='UNKNOWN' WHERE dataset_id=:d").param("d",d).update();
  String url="/api/system/status?datasetId="+d;
  FakeAi.CAPS.set("legacy");
  mvc.perform(get(url)).andExpect(jsonPath("$.capabilities.vespa.state").value("UNAVAILABLE")).andExpect(jsonPath("$.capabilities.vespa.reasonCode").value("VESPA_NOT_CONFIGURED"))
   .andExpect(jsonPath("$.capabilities.recording.state").value("CONFIGURED")).andExpect(jsonPath("$.capabilities.recording.canExecute").value(false))
   .andExpect(jsonPath("$.capabilities.recording.reasonCode").value("LEGACY_NOT_VERIFIED")).andExpect(jsonPath("$.capabilities.search.reasonCode").value("MODEL_NOT_READY"))
   .andExpect(jsonPath("$.capabilities.catalog.state").value("READY"));
  FakeAi.CAPS.set("missing");
  mvc.perform(get(url)).andExpect(jsonPath("$.capabilities.vespa.reasonCode").value("AI_ENDPOINT_UNSUPPORTED")).andExpect(jsonPath("$.capabilities.vespa.state").value("UNAVAILABLE"))
   .andExpect(jsonPath("$.capabilities.media.canExecute").value(true));
  FakeAi.CAPS.set("down");
  mvc.perform(get(url)).andExpect(jsonPath("$.capabilities.vespa.state").value("UNKNOWN")).andExpect(jsonPath("$.capabilities.vespa.reasonCode").value("AI_HTTP_ERROR"))
   .andExpect(jsonPath("$.capabilities.catalog.state").value("READY"));
  FakeAi.CAPS.set("vespa-configured");
  mvc.perform(get(url)).andExpect(jsonPath("$.capabilities.vespa.state").value("CONFIGURED")).andExpect(jsonPath("$.capabilities.vespa.canExecute").value(false))
   .andExpect(jsonPath("$.capabilities.vespa.reasonCode").value("EXECUTOR_NOT_CHECKED"));
  int refreshes=FakeAi.REFRESHES.get();
  mvc.perform(get(url+"&refresh=true")).andExpect(jsonPath("$.capabilities.vespa.state").value("UNAVAILABLE"))
   .andExpect(jsonPath("$.capabilities.vespa.reasonCode").value("VESPA_RUNTIME_NOT_READY"));
  assertThat(FakeAi.REFRESHES.get()).isEqualTo(refreshes+1);
  // status checks only read: no /auto-label, /recordings or /embedding calls, no job/recording rows
  assertThat(UNEXPECTED.get()).isZero();
  assertThat(jdbc.sql("SELECT count(*) FROM auto_label_job WHERE dataset_id=:d").param("d",d).query(Long.class).single()).isZero();
  assertThat(jdbc.sql("SELECT count(*) FROM scene_recording WHERE dataset_id=:d").param("d",d).query(Long.class).single()).isZero();
 }
}
