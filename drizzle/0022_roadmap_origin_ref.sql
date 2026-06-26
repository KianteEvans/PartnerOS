-- 0022_roadmap_origin_ref.sql
-- Roadmap Builder increment 3 (finalize -> action): persist the catalog key each
-- composed milestone advances -- the program library key for program milestones,
-- or "<tier>:<requirementKey>" for tier milestones. Finalizing a composed roadmap
-- then adopts those programs / opens the tier plan, and the detail page rolls real
-- program/tier progress back onto each milestone. Additive; RLS unchanged (0004).

ALTER TABLE roadmap_milestones
  ADD COLUMN IF NOT EXISTS origin_ref text NOT NULL DEFAULT '';
