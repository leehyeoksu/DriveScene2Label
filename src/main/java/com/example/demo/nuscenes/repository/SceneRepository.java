package com.example.demo.nuscenes.repository;
import com.example.demo.nuscenes.domain.Scene;
import java.util.List;
import java.util.Optional;
import org.springframework.data.repository.Repository;
import org.springframework.data.jdbc.repository.query.Query;
public interface SceneRepository extends Repository<Scene, Long> {
 Optional<Scene> findById(Long id);
 @Query("SELECT * FROM scene WHERE dataset_id = :datasetId ORDER BY name")
 List<Scene> findByDatasetId(long datasetId);
}
