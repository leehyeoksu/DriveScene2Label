package com.example.demo.nuscenes.api;

import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/** Image embedding lookups. Vectors are written by embedding/embed_images.py; text queries belong to the FastAPI side. */
@RestController
@RequestMapping("/api")
public class EmbeddingController {
 private final JdbcClient jdbc;
 private final String defaultModelName;
 private final String defaultPreprocess;
 public EmbeddingController(JdbcClient jdbc, @Value("${embedding.model-name}") String defaultModelName,
   @Value("${embedding.preprocess}") String defaultPreprocess) {
  this.jdbc=jdbc; this.defaultModelName=defaultModelName; this.defaultPreprocess=defaultPreprocess;
 }

 public record ModelCount(String modelName, String preprocess, long images) {}
 @GetMapping("/datasets/{id}/embeddings") public List<ModelCount> models(@PathVariable long id) {
  return jdbc.sql("""
   SELECT model_name, preprocess, count(*) AS images FROM image_embedding WHERE dataset_id=:id
   GROUP BY model_name, preprocess ORDER BY model_name, preprocess
   """).param("id",id).query(ModelCount.class).list();
 }

 public record SimilarImage(long id, String token, String sceneName, String sampleToken, String channel,
   String relativePath, long timestampUs, double distance, String contentUrl) {}
 public record Source(long datasetId, String token, String sceneToken) {}
 /** Nearest camera images to a stored image (cosine distance, lower is closer). Only the same model and preprocess are compared. */
 @Transactional(readOnly=true)
 @GetMapping("/sensor-files/{id}/similar") public List<SimilarImage> similar(@PathVariable long id,
   @RequestParam(defaultValue="10") int limit, @RequestParam(required=false) String modelName,
   @RequestParam(required=false) String preprocess, @RequestParam(defaultValue="false") boolean excludeSameScene) {
  if(limit<1 || limit>100) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"limit must be 1..100");
  String m = modelName==null || modelName.isBlank() ? defaultModelName : modelName;
  String p = preprocess==null || preprocess.isBlank() ? defaultPreprocess : preprocess;
  Source source=jdbc.sql("""
   SELECT sd.dataset_id, sd.token, sa.scene_token FROM image_embedding e
   JOIN sample_data sd ON sd.dataset_id=e.dataset_id AND sd.token=e.sample_data_token
   JOIN sample sa ON sa.dataset_id=sd.dataset_id AND sa.token=sd.sample_token
   WHERE sd.id=:id AND e.model_name=:model AND e.preprocess=:preprocess
   """).param("id",id).param("model",m).param("preprocess",p).query(Source.class).optional()
   .orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"No embedding for this file, model and preprocess"));
  return jdbc.sql("""
   SELECT sd.id, sd.token, sc.name AS scene_name, sd.sample_token, s.channel, sd.relative_path, sd.timestamp_us,
     e.embedding <=> q.embedding AS distance,
     '/api/sensor-files/' || sd.id || '/content' AS content_url
   FROM image_embedding e
   JOIN image_embedding q ON q.dataset_id=e.dataset_id AND q.sample_data_token=:token
     AND q.model_name=e.model_name AND q.preprocess=e.preprocess
   JOIN sample_data sd ON sd.dataset_id=e.dataset_id AND sd.token=e.sample_data_token
   JOIN calibrated_sensor cs ON cs.dataset_id=sd.dataset_id AND cs.token=sd.calibrated_sensor_token
   JOIN sensor s ON s.dataset_id=cs.dataset_id AND s.token=cs.sensor_token
   JOIN sample sa ON sa.dataset_id=sd.dataset_id AND sa.token=sd.sample_token
   JOIN scene sc ON sc.dataset_id=sa.dataset_id AND sc.token=sa.scene_token
   WHERE e.dataset_id=:dataset AND e.model_name=:model AND e.preprocess=:preprocess AND e.sample_data_token<>:token
     AND (:excludeSameScene=false OR sa.scene_token<>:scene)
   ORDER BY distance
   LIMIT :limit
   """).param("dataset",source.datasetId()).param("token",source.token()).param("model",m).param("preprocess",p)
   .param("excludeSameScene",excludeSameScene).param("scene",source.sceneToken()).param("limit",limit)
   .query(SimilarImage.class).list();
 }
}
