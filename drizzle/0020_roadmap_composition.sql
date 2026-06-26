-- 0020_roadmap_composition.sql
-- Roadmap Builder: compose a roadmap from selected AWS Programs + a target tier.
-- Adds a 'composed' roadmap source and per-milestone origin tagging (which
-- program / tier advancement a milestone advances), so a composed plan reads as
-- a differentiation story on the detail page. Additive only; RLS for both
-- tables is unchanged (defined in 0004_roadmaps.sql).
--
-- ADD VALUE runs inside the migration transaction (PG 12+ allows this as long as
-- the new value is not USED in the same transaction -- it is not here).

ALTER TYPE roadmap_source ADD VALUE IF NOT EXISTS 'composed';

ALTER TABLE roadmap_milestones
  ADD COLUMN IF NOT EXISTS origin_kind text NOT NULL DEFAULT 'custom';

ALTER TABLE roadmap_milestones
  ADD COLUMN IF NOT EXISTS origin_label text NOT NULL DEFAULT '';
