package com.example.demo.nuscenes.storage;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class DatasetFiles {
 private final Path root;
 public DatasetFiles(@Value("${nuscenes.root}") String root) { this.root = Path.of(root).toAbsolutePath().normalize(); }
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
