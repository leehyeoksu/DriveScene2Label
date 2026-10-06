CREATE TABLE dataset_ingestion (
 id UUID PRIMARY KEY, dataset_id BIGINT REFERENCES dataset(id), name TEXT NOT NULL, version TEXT NOT NULL,
 origin TEXT NOT NULL CHECK (origin IN ('NUSCENES','SYNTHETIC','UNKNOWN')),
 status TEXT NOT NULL CHECK (status IN ('UPLOADING','QUEUED','RUNNING','COMPLETED','FAILED')),
 stage TEXT NOT NULL, uploaded_files INTEGER NOT NULL DEFAULT 0, uploaded_bytes BIGINT NOT NULL DEFAULT 0,
 total_images INTEGER NOT NULL DEFAULT 0, completed_images INTEGER NOT NULL DEFAULT 0, error_message TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX dataset_ingestion_active ON dataset_ingestion(dataset_id)
 WHERE dataset_id IS NOT NULL AND status IN ('QUEUED','RUNNING');
CREATE TABLE dataset_upload_file (
 ingestion_id UUID NOT NULL REFERENCES dataset_ingestion(id), relative_path TEXT NOT NULL,
 size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0), PRIMARY KEY(ingestion_id,relative_path)
);
