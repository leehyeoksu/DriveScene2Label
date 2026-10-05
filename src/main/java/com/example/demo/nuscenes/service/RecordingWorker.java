package com.example.demo.nuscenes.service;
import com.example.demo.nuscenes.client.RecordingClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;
/** Polls PENDING recordings. Claim and READY/FAILED are short DB statements; no transaction is held during the AI export call. */
@Component
@ConditionalOnProperty(name="recording.worker.enabled",havingValue="true",matchIfMissing=true)
public class RecordingWorker {
 private static final Logger log=LoggerFactory.getLogger(RecordingWorker.class);
 private static final tools.jackson.databind.ObjectMapper JSON=new tools.jackson.databind.ObjectMapper();
 private final RecordingService recordings; private final RecordingClient ai;
 public RecordingWorker(RecordingService recordings,RecordingClient ai) { this.recordings=recordings;this.ai=ai; }
 @Scheduled(fixedDelayString="${recording.poll-delay-ms:1000}")
 public void runNextRecording() {
  try {
   var claimed=recordings.claim(); if(claimed.isEmpty()) return; var work=claimed.get();
   try {
    log.info("[RERUN] recording={} scene={} job={} started",work.id(),work.sceneToken(),work.jobId());
    var request=recordings.request(work); var result=ai.export(request); recordings.complete(work,request,result);
    log.info("[RERUN] recording={} ready samples={}",work.id(),request.samples().size());
   } catch(Exception e) {
    log.warn("[RERUN] recording={} failed: {}",work.id(),e.toString());
    recordings.fail(work,reason(e));
   }
  } catch(Exception e) { log.error("Recording worker iteration failed",e); }
 }
 static String reason(Exception e) {
  if(e instanceof RecordingService.Invalid) return e.getMessage();
  if(e instanceof RestClientResponseException r) {
   String code="";
   try { code=JSON.readTree(r.getResponseBodyAsString()).path("detail").path("code").asText().replaceAll("[^A-Za-z0-9_.-]",""); } catch(Exception ignored) {}
   if(code.length()>60) code=code.substring(0,60);
   return "AI recording export failed (HTTP "+r.getStatusCode().value()+(code.isEmpty()?"":" "+code)+")";
  }
  if(e instanceof RestClientException) return "AI recording request failed or timed out";
  return "Recording validation or storage failed";
 }
}
