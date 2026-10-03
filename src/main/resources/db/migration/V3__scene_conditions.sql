-- Weather / time-of-day flags for each scene, parsed from nuScenes scene.description (e.g. "Night, after rain, ...").
-- Generated columns: filled automatically on every insert, so the importer and Java code need no changes.
-- Keyword match only: "after rain" also counts as rain. Data without a description needs a separate (non-generated) column.
ALTER TABLE scene
 ADD COLUMN is_night BOOLEAN GENERATED ALWAYS AS (description ~* '\mnight\M') STORED,
 ADD COLUMN is_rain BOOLEAN GENERATED ALWAYS AS (description ~* '\mrain(y|ing)?\M') STORED;

CREATE INDEX idx_scene_conditions ON scene(dataset_id, is_night, is_rain);
