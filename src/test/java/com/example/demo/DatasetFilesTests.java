package com.example.demo;
import com.example.demo.nuscenes.storage.DatasetFiles;
import java.nio.file.*;
import java.io.IOException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.assertj.core.api.Assertions.*;
class DatasetFilesTests {
 @TempDir Path temp;
 @Test void resolvesRealFilesButRejectsTraversalAbsolutePathsAndEscapingSymlinks() throws Exception {
  Path root=Files.createDirectory(temp.resolve("dataset"));
  Path inside=Files.writeString(root.resolve("image.jpg"),"inside");
  Path outside=Files.writeString(temp.resolve("outside.jpg"),"outside");
  DatasetFiles files=new DatasetFiles(root.toString());
  assertThat(files.resolve("image.jpg")).isEqualTo(inside.toRealPath());
  assertThatThrownBy(()->files.resolve("../outside.jpg")).isInstanceOf(IOException.class);
  assertThatThrownBy(()->files.resolve(outside.toString())).isInstanceOf(IOException.class);
  Files.createSymbolicLink(root.resolve("escape.jpg"),outside);
  assertThatThrownBy(()->files.resolve("escape.jpg")).isInstanceOf(IOException.class);
  assertThatThrownBy(()->files.resolve("missing.jpg")).isInstanceOf(IOException.class);
 }
}
