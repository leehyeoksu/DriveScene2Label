package com.example.demo.nuscenes.client;
import com.example.demo.nuscenes.dto.AutoLabelDtos.*;
import java.net.http.HttpClient;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
@Component
public class AutoLabelClient {
 private final RestClient client;
 private final org.springframework.jdbc.core.simple.JdbcClient jdbc;
 public AutoLabelClient(@Value("${ai-server.base-url}") String url,@Value("${ai-server.connect-timeout:5s}") Duration connect,
   @Value("${auto-label.read-timeout:7300s}") Duration read,org.springframework.jdbc.core.simple.JdbcClient jdbc) {
  this.jdbc=jdbc;
  var factory=new JdkClientHttpRequestFactory(HttpClient.newBuilder().connectTimeout(connect).build()); factory.setReadTimeout(read);
  client=RestClient.builder().baseUrl(url).requestFactory(factory).build();
 }
 public AiResponse run(Work job) {
  var ds=jdbc.sql("SELECT storage_key,root_relative_path,version FROM dataset WHERE id=:id").param("id",job.datasetId())
   .query((r,n)->new String[]{r.getString(1),r.getString(2),r.getString(3)}).single();
  return client.post().uri("/auto-label").contentType(MediaType.APPLICATION_JSON).accept(MediaType.APPLICATION_JSON)
   .body(new AiRequest(job.sceneName(),Integer.parseInt(job.mappingName().replace("class","")),job.id(),job.executionToken(),"uploads".equals(ds[0])?ds[1]:null,ds[2]))
   .retrieve().body(AiResponse.class);
 }
}
