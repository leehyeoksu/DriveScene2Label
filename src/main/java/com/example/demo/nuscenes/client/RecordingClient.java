package com.example.demo.nuscenes.client;
import com.example.demo.nuscenes.dto.RecordingDtos.*;
import java.net.http.HttpClient;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
@Component
public class RecordingClient {
 private final RestClient client;
 public RecordingClient(@Value("${ai-server.base-url}") String url,@Value("${ai-server.connect-timeout:5s}") Duration connect,
   @Value("${recording.read-timeout:660s}") Duration read) {
  var factory=new JdkClientHttpRequestFactory(HttpClient.newBuilder().connectTimeout(connect).build()); factory.setReadTimeout(read);
  client=RestClient.builder().baseUrl(url).requestFactory(factory).build();
 }
 public AiResponse export(AiRequest request) {
  return client.post().uri("/recordings").contentType(MediaType.APPLICATION_JSON).accept(MediaType.APPLICATION_JSON).body(request).retrieve().body(AiResponse.class);
 }
}
