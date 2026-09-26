package com.example.demo.nuscenes.importer;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
@Component
@ConditionalOnProperty(name="nuscenes.import.enabled", havingValue="true")
public class ImportRunner implements ApplicationRunner {
 private final NuscenesImporter importer;
 private final String version;
 public ImportRunner(NuscenesImporter importer, @Value("${nuscenes.version}") String version) { this.importer = importer; this.version = version; }
 @Override public void run(ApplicationArguments args) throws Exception { importer.importDataset(version); }
}
