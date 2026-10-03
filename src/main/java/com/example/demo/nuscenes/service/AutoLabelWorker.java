package com.example.demo.nuscenes.service;
import com.example.demo.nuscenes.client.AutoLabelClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
@Component
@ConditionalOnProperty(name="auto-label.worker.enabled",havingValue="true",matchIfMissing=true)
public class AutoLabelWorker {
 private static final Logger log=LoggerFactory.getLogger(AutoLabelWorker.class);
 private final AutoLabelService jobs; private final AutoLabelClient ai;
 public AutoLabelWorker(AutoLabelService jobs,AutoLabelClient ai) { this.jobs=jobs;this.ai=ai; }
 @Scheduled(fixedDelayString="${auto-label.poll-delay-ms:1000}")
 public void runNextJob() {
  try {
   var pending=jobs.claim(); if(pending.isEmpty()) return; var job=pending.get();
   try {
    log.info("[VESPA] job={} scene={} started",job.id(),job.sceneName());
    var result=ai.run(job); jobs.complete(job,result);
    log.info("[VESPA] job={} completed boxes={}",job.id(),result.results().values().stream().mapToInt(java.util.List::size).sum());
   }
   catch(Exception e) {
    log.error("Auto-label job {} failed",job.id(),e);
    String reason=e instanceof org.springframework.web.client.RestClientException ? "AI request failed or timed out" : "AI result validation or storage failed";
    jobs.fail(job,reason);
   }
  } catch(Exception e) { log.error("Auto-label worker iteration failed",e); }
 }
}
