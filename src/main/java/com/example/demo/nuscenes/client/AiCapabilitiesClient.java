package com.example.demo.nuscenes.client;
import java.net.http.HttpClient;
import java.time.Duration;
import java.time.OffsetDateTime;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
/**
 * Reads the AI server's per-feature readiness (GET /capabilities). An older AI without that route is read through
 * its /health ({@code legacy=true}); missing fields are never treated as ready. Short timeouts: this is a light read.
 */
@Component
public class AiCapabilitiesClient {
 /** body is /capabilities (legacy=false) or /health (legacy=true); null when unreachable/unsupported (code set). */
 public record Snapshot(JsonNode body,boolean legacy,String errorCode,OffsetDateTime fetchedAt,boolean refreshed) {
  public boolean reachable() { return body!=null; }
 }
 private static final ObjectMapper JSON=new ObjectMapper();
 private final RestClient normal, refresh;
 public AiCapabilitiesClient(@Value("${ai-server.base-url}") String url,@Value("${ai-server.capabilities.connect-timeout:2s}") Duration connect,
   @Value("${ai-server.capabilities.read-timeout:5s}") Duration read,@Value("${ai-server.capabilities.refresh-timeout:90s}") Duration refreshRead) {
  normal=client(url,connect,read); refresh=client(url,connect,refreshRead);
 }
 private static RestClient client(String url,Duration connect,Duration read) {
  var factory=new JdkClientHttpRequestFactory(HttpClient.newBuilder().connectTimeout(connect).build()); factory.setReadTimeout(read);
  return RestClient.builder().baseUrl(url).requestFactory(factory).build();
 }
 public Snapshot fetchUpload(boolean doRefresh,String uploadId,String version) {
  var now=OffsetDateTime.now();
  try {
   String body=(doRefresh?refresh:normal).get().uri("/capabilities?refresh={r}&upload_id={id}&dataset_version={v}",doRefresh,uploadId,version).retrieve().body(String.class);
   return new Snapshot(JSON.readTree(body),false,null,now,doRefresh);
  } catch(RuntimeException e) { return new Snapshot(null,false,AiErrors.code(e),now,doRefresh); }
 }
 public Snapshot fetch(boolean doRefresh) {
  var now=OffsetDateTime.now();
  try {
   String body=(doRefresh?refresh:normal).get().uri("/capabilities?refresh={r}",doRefresh).retrieve().body(String.class);
   return new Snapshot(JSON.readTree(body),false,null,now,doRefresh);
  } catch(RestClientResponseException e) {
   if(e.getStatusCode().value()!=404) return new Snapshot(null,false,AiErrors.code(e),now,doRefresh);
  } catch(RestClientException e) { return new Snapshot(null,false,AiErrors.code(e),now,doRefresh); }
  catch(RuntimeException e) { return new Snapshot(null,false,"AI_HTTP_ERROR",now,doRefresh); }
  // Older AI: /health answers 200 (CLIP ready) or 503 (not ready) with the same JSON shape.
  try {
   String body=normal.get().uri("/health").retrieve().onStatus(s->s.value()==503,(req,res)->{}).body(String.class);
   return new Snapshot(JSON.readTree(body),true,null,now,false);
  } catch(RestClientResponseException e) {
   return new Snapshot(null,true,e.getStatusCode().value()==404?"AI_ENDPOINT_UNSUPPORTED":AiErrors.code(e),now,false);
  } catch(RuntimeException e) { return new Snapshot(null,true,AiErrors.code(e),now,false); }
 }
}
