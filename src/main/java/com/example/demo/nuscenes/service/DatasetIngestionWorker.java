package com.example.demo.nuscenes.service;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
@Component
@ConditionalOnProperty(name="ingestion.worker.enabled",havingValue="true",matchIfMissing=true)
public class DatasetIngestionWorker {
 private final DatasetIngestionService service; private volatile boolean ready;
 public DatasetIngestionWorker(DatasetIngestionService service) { this.service=service; }
 @EventListener(ApplicationReadyEvent.class) public void start() { service.recover(); ready=true; }
 @Scheduled(fixedDelayString="${ingestion.poll-delay-ms:1000}",scheduler="ingestionScheduler")
 public void work() {
  if(!ready) return;
  try { service.runNext(); } catch(Exception e) { org.slf4j.LoggerFactory.getLogger(getClass()).error("Dataset worker failed",e); }
 }
}
