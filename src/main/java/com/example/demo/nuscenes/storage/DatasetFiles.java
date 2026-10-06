package com.example.demo.nuscenes.storage;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class DatasetFiles {
 private final Path root;
 private final Path uploads;
 @org.springframework.beans.factory.annotation.Autowired
 public DatasetFiles(@Value("${nuscenes.root}") String root, @Value("${uploads.root:/data/uploads}") String uploads) {
  this.root=Path.of(root).toAbsolutePath().normalize(); this.uploads=Path.of(uploads).toAbsolutePath().normalize();
 }
 public DatasetFiles(String root) { this(root, "/data/uploads"); }
 public Path uploads() { return uploads; }
 public Path datasetRoot(String key,String relative) throws IOException {
  if ("nuscenes".equals(key) && ".".equals(relative)) return root;
  if ("uploads".equals(key) && relative != null && relative.matches("[0-9a-f-]{36}")) {
   java.util.UUID.fromString(relative); return uploads.resolve(relative);
  }
  throw new IOException("Unsupported dataset storage");
 }
 public Path resolve(String key,String relative,String file) throws IOException {
  return new DatasetFiles(datasetRoot(key,relative).toString()).resolve(file);
 }
 public static String aiPath(String key,String relative,String file) {
  if ("nuscenes".equals(key) && ".".equals(relative)) return file;
  if ("uploads".equals(key) && relative != null && relative.matches("[0-9a-f-]{36}")) return "__uploads__/"+relative+"/"+file;
  throw new IllegalArgumentException("Unsupported dataset storage");
 }
 public Path root() { return root; }
 public Path resolve(String relativePath) throws IOException {
  if (relativePath == null || relativePath.isBlank() || Path.of(relativePath).isAbsolute()) {
   throw new IOException("Relative dataset path required");
  }
  Path realRoot = root.toRealPath();
  Path candidate = realRoot.resolve(relativePath).normalize();
  if (!candidate.startsWith(realRoot)) throw new IOException("Path outside dataset");
  Path realFile = candidate.toRealPath();
  if (!realFile.startsWith(realRoot) || !Files.isRegularFile(realFile)) throw new IOException("Invalid dataset file");
  return realFile;
 }
}
