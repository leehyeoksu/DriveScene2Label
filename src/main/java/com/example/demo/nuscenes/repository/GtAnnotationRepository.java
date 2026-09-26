package com.example.demo.nuscenes.repository;
import com.example.demo.nuscenes.domain.GtAnnotation;
import java.util.List;
import java.util.Optional;
import org.springframework.data.repository.Repository;
import org.springframework.data.jdbc.repository.query.Query;
public interface GtAnnotationRepository extends Repository<GtAnnotation, Long> {
 Optional<GtAnnotation> findById(Long id);
 @Query("SELECT * FROM gt_annotation WHERE dataset_id = :datasetId AND sample_token = :sampleToken ORDER BY token")
 List<GtAnnotation> listBySample(long datasetId, String sampleToken);
}
