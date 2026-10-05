package com.example.demo.nuscenes.repository;
import com.example.demo.nuscenes.dto.GtAnnotationView;
import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
/** GT with its dataset-scoped instance→category. Order within a sample is g.token, shared by the annotations API and recording mapping. */
@Repository
public class GtAnnotationViewRepository {
 private static final String SELECT="""
  SELECT g.id,g.dataset_id,g.token,g.sample_token,g.instance_token,g.visibility_token,g.center_x,g.center_y,g.center_z,g.size_w,g.size_l,g.size_h,
   g.rotation_w,g.rotation_x,g.rotation_y,g.rotation_z,g.num_lidar_pts,g.num_radar_pts,g.prev_token,g.next_token,i.category_token,c.name AS category_name
  FROM gt_annotation g
  LEFT JOIN object_instance i ON i.dataset_id=g.dataset_id AND i.token=g.instance_token
  LEFT JOIN category c ON c.dataset_id=i.dataset_id AND c.token=i.category_token
  """;
 private final JdbcClient jdbc;
 public GtAnnotationViewRepository(JdbcClient jdbc) { this.jdbc=jdbc; }
 public List<GtAnnotationView> bySample(long dataset,String sample) {
  return jdbc.sql(SELECT+" WHERE g.dataset_id=:d AND g.sample_token=:s ORDER BY g.token").param("d",dataset).param("s",sample).query(GtAnnotationView.class).list();
 }
 /** All GT of a scene, grouped by sample_token and ordered by g.token inside each sample. */
 public List<GtAnnotationView> byScene(long dataset,String scene) {
  return jdbc.sql(SELECT+" JOIN sample s ON s.dataset_id=g.dataset_id AND s.token=g.sample_token WHERE g.dataset_id=:d AND s.scene_token=:s ORDER BY g.sample_token,g.token")
   .param("d",dataset).param("s",scene).query(GtAnnotationView.class).list();
 }
}
