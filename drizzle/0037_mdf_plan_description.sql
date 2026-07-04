-- The AWS marketing-plan template requires a "Description of Activity" per event;
-- it's the only required field the planner doesn't yet capture. Additive column.
-- ASCII only (WIN1252 embedded-pg).

ALTER TABLE mdf_plan_items ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
