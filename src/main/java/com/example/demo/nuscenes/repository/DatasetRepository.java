package com.example.demo.nuscenes.repository;
import com.example.demo.nuscenes.domain.Dataset;
import java.util.List;
import java.util.Optional;
import org.springframework.data.repository.Repository;
import org.springframework.data.jdbc.repository.query.Query;
public interface DatasetRepository extends Repository<Dataset, Long> {
 Optional<Dataset> findById(Long id);
 @Query("SELECT * FROM dataset ORDER BY id")
 List<Dataset> listAll();
}
