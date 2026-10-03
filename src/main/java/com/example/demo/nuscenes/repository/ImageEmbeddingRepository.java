package com.example.demo.nuscenes.repository;
import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
@Repository
public class ImageEmbeddingRepository {
 public record Source(long datasetId,String token,String relativePath,String modality,String storageKey,String rootRelativePath) {}
 private final JdbcClient jdbc;
 public ImageEmbeddingRepository(JdbcClient jdbc) { this.jdbc=jdbc; }
 public Optional<Source> source(long id) { return jdbc.sql("""
 SELECT sd.dataset_id,sd.token,sd.relative_path,s.modality,d.storage_key,d.root_relative_path FROM sample_data sd
 JOIN dataset d ON d.id=sd.dataset_id JOIN calibrated_sensor c ON c.dataset_id=sd.dataset_id AND c.token=sd.calibrated_sensor_token
 JOIN sensor s ON s.dataset_id=c.dataset_id AND s.token=c.sensor_token WHERE sd.id=:id
 """).param("id",id).query(Source.class).optional(); }
 public boolean exists(Source s,String model,String preprocess) { return jdbc.sql("SELECT EXISTS(SELECT 1 FROM image_embedding WHERE dataset_id=:d AND sample_data_token=:t AND model_name=:m AND preprocess=:p)").param("d",s.datasetId()).param("t",s.token()).param("m",model).param("p",preprocess).query(Boolean.class).single(); }
 public int save(Source s,String model,String preprocess,String vector,boolean overwrite) {
  String conflict=overwrite?"DO UPDATE SET embedding=EXCLUDED.embedding,created_at=now()":"DO NOTHING";
  return jdbc.sql("INSERT INTO image_embedding(dataset_id,sample_data_token,model_name,preprocess,embedding) VALUES(:d,:t,:m,:p,CAST(:v AS vector)) ON CONFLICT(dataset_id,sample_data_token,model_name,preprocess) "+conflict)
   .param("d",s.datasetId()).param("t",s.token()).param("m",model).param("p",preprocess).param("v",vector).update();
 }
}
