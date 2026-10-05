-- Stable public identifier of this database (not a secret). Clients scope receipts/caches by it so that job 2 of a
-- test DB is never restored as job 2 of another DB. Generated once; survives restarts.
CREATE TABLE system_instance (
 singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
 instance_id UUID NOT NULL UNIQUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO system_instance(instance_id) VALUES (gen_random_uuid());

-- Data origin bound to the metadata checksum it was recorded for. A dataset without a row (or whose
-- source_checksum differs) is UNKNOWN. Origin is never inferred from the dataset name/version/sample count.
CREATE TABLE dataset_provenance (
 dataset_id BIGINT PRIMARY KEY REFERENCES dataset(id),
 origin TEXT NOT NULL CHECK (origin IN ('SYNTHETIC','NUSCENES','UNKNOWN')),
 metadata_checksum TEXT NOT NULL CHECK (metadata_checksum ~ '^[0-9a-f]{64}$'),
 media_validation TEXT NOT NULL DEFAULT 'NOT_CHECKED' CHECK (media_validation IN ('NOT_CHECKED','PARTIAL','VERIFIED','FAILED')),
 recorded_by TEXT NOT NULL,
 validated_at TIMESTAMPTZ,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON COLUMN dataset_provenance.media_validation IS 'PARTIAL: importer resolved every sample_data/map file path when it recorded this row; contents not verified.';

-- Stable failure identifiers next to the existing free-text reasons. NULL for rows written before this migration;
-- old reasons are not reinterpreted.
ALTER TABLE auto_label_job ADD COLUMN error_code TEXT CHECK (error_code IS NULL OR error_code ~ '^[A-Z0-9_]{1,64}$');
ALTER TABLE scene_recording ADD COLUMN error_code TEXT CHECK (error_code IS NULL OR error_code ~ '^[A-Z0-9_]{1,64}$');
