package com.example.demo.nuscenes.storage;

import java.io.IOException;
import java.nio.file.Path;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Recording files under recording.root, with the same traversal/symlink rules as dataset files. */
@Component
public class RecordingFiles {
 private final DatasetFiles files;
 public RecordingFiles(@Value("${recording.root}") String root) { files=new DatasetFiles(root); }
 public Path root() { return files.root(); }
 public Path resolve(String relativePath) throws IOException {
  if(relativePath==null || relativePath.contains("..") || relativePath.contains("\\") || relativePath.contains(":")) throw new IOException("Invalid recording path");
  return files.resolve(relativePath);
 }
}
