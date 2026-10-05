package com.example.demo;
import com.example.demo.nuscenes.client.AiErrors;
import java.net.ConnectException;
import java.net.http.HttpConnectTimeoutException;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.client.ResourceAccessException;
import static org.assertj.core.api.Assertions.assertThat;
/** IT-05: where a Spring → AI call failed is kept (route missing ≠ timeout ≠ refused ≠ AI-reported failure). */
class AiErrorsTests {
 static HttpClientErrorException client(int status,String body) { return HttpClientErrorException.create(HttpStatus.valueOf(status),"x",HttpHeaders.EMPTY,body.getBytes(StandardCharsets.UTF_8),StandardCharsets.UTF_8); }
 static HttpServerErrorException server(int status,String body) { return HttpServerErrorException.create(HttpStatus.valueOf(status),"x",HttpHeaders.EMPTY,body.getBytes(StandardCharsets.UTF_8),StandardCharsets.UTF_8); }
 @Test void classifies() {
  assertThat(AiErrors.code(client(404,"{\"detail\":\"Not Found\"}"))).isEqualTo("AI_ENDPOINT_UNSUPPORTED");
  assertThat(AiErrors.code(client(404,"{\"detail\":{\"code\":\"SCENE_NOT_FOUND\",\"message\":\"x\"}}"))).isEqualTo("SCENE_NOT_FOUND");
  assertThat(AiErrors.code(server(502,"{\"detail\":{\"code\":\"VESPA_EXECUTION_FAILED\",\"message\":\"x\"}}"))).isEqualTo("VESPA_EXECUTION_FAILED");
  assertThat(AiErrors.code(server(504,"{\"detail\":{\"code\":\"VESPA_TIMEOUT\",\"message\":\"x\"}}"))).isEqualTo("VESPA_TIMEOUT");
  assertThat(AiErrors.code(server(502,"Bad Gateway"))).isEqualTo("AI_HTTP_ERROR"); // a bare 502 is not called an AI model failure
  assertThat(AiErrors.code(server(502,"{\"detail\":{\"code\":\"rm -rf\"}}"))).isEqualTo("AI_HTTP_ERROR");
  assertThat(AiErrors.code(new ResourceAccessException("x",new ConnectException("refused")))).isEqualTo("AI_UNREACHABLE");
  assertThat(AiErrors.code(new ResourceAccessException("x",new HttpConnectTimeoutException("connect")))).isEqualTo("AI_UNREACHABLE");
  assertThat(AiErrors.code(new ResourceAccessException("x",new HttpTimeoutException("read")))).isEqualTo("AI_TIMEOUT");
 }
}
