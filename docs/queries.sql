-- 1. List the tables created in this database.
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;

-- 2. Number of scenes, keyframes, sensor files, and ground-truth boxes.
SELECT d.id, d.name, d.version,
 (SELECT count(*) FROM scene s WHERE s.dataset_id=d.id) AS scenes,
 (SELECT count(*) FROM sample s WHERE s.dataset_id=d.id) AS samples,
 (SELECT count(*) FROM sample_data s WHERE s.dataset_id=d.id) AS sensor_files,
 (SELECT count(*) FROM gt_annotation a WHERE a.dataset_id=d.id) AS gt_boxes
FROM dataset d;

-- 3. Camera / LiDAR / radar file counts by channel and keyframe status.
SELECT sd.dataset_id, s.channel, s.modality, sd.is_key_frame, count(*) AS file_count
FROM sample_data sd
JOIN calibrated_sensor cs ON cs.dataset_id=sd.dataset_id AND cs.token=sd.calibrated_sensor_token
JOIN sensor s ON s.dataset_id=cs.dataset_id AND s.token=cs.sensor_token
GROUP BY sd.dataset_id, s.channel, s.modality, sd.is_key_frame
ORDER BY sd.dataset_id, s.channel, sd.is_key_frame DESC;

-- 4. Files for the first chronological sample in scene-0061.
SELECT s.channel, sd.relative_path
FROM sample_data sd
JOIN calibrated_sensor cs ON cs.dataset_id=sd.dataset_id AND cs.token=sd.calibrated_sensor_token
JOIN sensor s ON s.dataset_id=cs.dataset_id AND s.token=cs.sensor_token
WHERE sd.is_key_frame AND (sd.dataset_id, sd.sample_token) = (
 SELECT sa.dataset_id, sa.token FROM sample sa
 JOIN scene sc ON sc.dataset_id=sa.dataset_id AND sc.token=sa.scene_token
 WHERE sc.name='scene-0061' ORDER BY sa.dataset_id, sa.timestamp_us LIMIT 1
)
ORDER BY s.channel;

-- 5. Example ground-truth objects and original nuScenes categories.
SELECT a.id, a.sample_token, c.name, a.center_x, a.center_y, a.center_z,
 a.size_w, a.size_l, a.size_h
FROM gt_annotation a
JOIN object_instance i ON i.dataset_id=a.dataset_id AND i.token=a.instance_token
JOIN category c ON c.dataset_id=i.dataset_id AND c.token=i.category_token
ORDER BY a.id LIMIT 10;

-- Image embeddings per model and preprocess (CLIP, filled by scripts/embed.sh).
SELECT dataset_id, model_name, preprocess, count(*) AS images FROM image_embedding
GROUP BY dataset_id, model_name, preprocess ORDER BY dataset_id, model_name, preprocess;

-- 5 camera images most similar to the first stored embedding of the default model and preprocess
-- (embedding.model-name / embedding.preprocess). Cosine distance, lower = closer.
-- Only rows with the same model_name and preprocess are comparable.
SELECT sd.relative_path, e.embedding <=> q.embedding AS distance
FROM image_embedding e
JOIN (SELECT dataset_id, model_name, preprocess, embedding FROM image_embedding
      WHERE model_name='ViT-L-14-quickgelu/openai' AND preprocess='lr-square-crop-mean' ORDER BY id LIMIT 1) q
  ON q.dataset_id=e.dataset_id AND q.model_name=e.model_name AND q.preprocess=e.preprocess
JOIN sample_data sd ON sd.dataset_id=e.dataset_id AND sd.token=e.sample_data_token
ORDER BY distance LIMIT 5;
