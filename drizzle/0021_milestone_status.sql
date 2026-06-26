-- 0021_milestone_status.sql
-- Roadmap Builder increment 2: per-milestone status, so a roadmap is a living
-- plan that tracks progress rather than a one-way draft -> finalized switch.
-- Status is editable in any roadmap state (it is progress, not structure);
-- reorder / add / remove remain draft-only. Additive; RLS unchanged (0004).

DO $$ BEGIN
  CREATE TYPE milestone_status AS ENUM ('planned', 'in_progress', 'done', 'blocked');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE roadmap_milestones
  ADD COLUMN IF NOT EXISTS status milestone_status NOT NULL DEFAULT 'planned';
