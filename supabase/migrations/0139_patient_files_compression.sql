-- Tracks whether a patient_files row has already been through the
-- image-recompression pass (server/utils/compressPatientFile.ts), so the
-- self-serve "Compress files" tool in Settings can be called repeatedly
-- (each call processes a batch of not-yet-compressed rows) without ever
-- reprocessing a file twice or needing a separate cursor/offset to resume
-- from. Null means "not compressed yet" -- covers every row that already
-- exists today.
alter table patient_files add column compressed_at timestamptz;

create index patient_files_uncompressed_idx on patient_files (account_id, created_at)
  where compressed_at is null and storage_path is not null;
