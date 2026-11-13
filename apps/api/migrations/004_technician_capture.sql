-- Keep already submitted v1 batches reviewable. New drafts use capture_version=2.
ALTER TABLE zc_batches ADD COLUMN capture_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE zc_batches ADD COLUMN checklist_signed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE zc_evidence ADD COLUMN equipment_type TEXT NOT NULL DEFAULT '';
ALTER TABLE zc_evidence ADD COLUMN equipment_model TEXT NOT NULL DEFAULT '';
