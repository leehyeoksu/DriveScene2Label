package com.example.demo.nuscenes.service;
import com.example.demo.nuscenes.client.TextEmbeddingClient;
import com.example.demo.nuscenes.repository.ImageEmbeddingRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
@Service
public class ImageEmbeddingService {
 public record Result(long sensorFileId,long datasetId,String sampleDataToken,String modelName,String preprocess,int dimension,String status) {}
 private final TextEmbeddingClient ai; private final ImageEmbeddingRepository repo; private final String model,preprocess;
 public ImageEmbeddingService(TextEmbeddingClient ai,ImageEmbeddingRepository repo,@Value("${embedding.model-name}") String model,@Value("${embedding.preprocess}") String preprocess) { this.ai=ai;this.repo=repo;this.model=model;this.preprocess=preprocess; }
 public Result embed(long id,boolean overwrite) {
  var source=repo.source(id).orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"Sensor file not found"));
  if(!"camera".equals(source.modality())) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Only camera images can be embedded");
  String imagePath;
  try { imagePath=com.example.demo.nuscenes.storage.DatasetFiles.aiPath(source.storageKey(),source.rootRelativePath(),source.relativePath()); }
  catch(IllegalArgumentException e) { throw new ResponseStatusException(HttpStatus.CONFLICT,"Dataset does not map to the configured AI image root"); }
  String status="SKIPPED";
  if(overwrite || !repo.exists(source,model,preprocess)) {
   String vector=EmbeddingValidator.vector(ai.image(imagePath,preprocess),model,preprocess);
   // A single atomic upsert follows HTTP inference; no database transaction spans inference.
   if(repo.save(source,model,preprocess,vector,overwrite)>0) status="STORED";
  }
  org.slf4j.LoggerFactory.getLogger(getClass()).info("[CLIP] image={} status={}",id,status);
  return new Result(id,source.datasetId(),source.token(),model,preprocess,768,status);
 }
}
