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
