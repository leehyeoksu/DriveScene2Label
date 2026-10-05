package com.example.demo.nuscenes.client;
import java.net.ConnectException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.net.http.HttpConnectTimeoutException;
import java.net.http.HttpTimeoutException;
import java.util.Set;
import org.springframework.web.client.RestClientResponseException;
import tools.jackson.databind.ObjectMapper;
/**
 * Maps a failed Spring → AI call to a stable error code. An HTTP 404 without an AI error code means the route does
 * not exist (wrong/older AI), which is different from a timeout or a refused connection. AI business codes
 * ({"detail":{"code"}}) are kept when they belong to a known family.
 */
public final class AiErrors {
 private AiErrors() {}
 private static final ObjectMapper JSON=new ObjectMapper();
 private static final Set<String> FAMILIES=Set.of("VESPA_","RECORDING_","CLIP_","SCENE_NOT_FOUND");
 public static String code(Throwable e) {
  if(e instanceof RestClientResponseException r) {
   String ai=aiCode(r.getResponseBodyAsString());
   if(ai!=null) return ai;
   return r.getStatusCode().value()==404?"AI_ENDPOINT_UNSUPPORTED":"AI_HTTP_ERROR";
  }
  for(Throwable t=e;t!=null;t=t.getCause()) {
   if(t instanceof HttpConnectTimeoutException || t instanceof ConnectException || t instanceof UnknownHostException) return "AI_UNREACHABLE";
   if(t instanceof HttpTimeoutException || t instanceof SocketTimeoutException) return "AI_TIMEOUT";
  }
  return "AI_UNREACHABLE";
 }
 static String aiCode(String body) {
  try {
   String code=JSON.readTree(body).path("detail").path("code").asString("");
   if(!code.matches("[A-Z0-9_]{1,64}")) return null;
   return FAMILIES.stream().anyMatch(code::startsWith)?code:null;
  } catch(RuntimeException e) { return null; }
 }
 public static int httpStatus(Throwable e) { return e instanceof RestClientResponseException r?r.getStatusCode().value():0; }
}
