-- Real AWS Consulting Partner tier criteria (catalog v2): tier requirements gain
-- richer shapes than a single numeric threshold. New columns on tier_requirements:
--   kind                    'count' | 'boolean' (boolean = met at current_value 1)
--   secondary_*             a 2nd numeric gate that must also be met (MRR, sub-min)
--   note                    a human constraint shown alongside ("Must include ...")
--   informational           context only (the annual fee) -- excluded from the gate
-- Additive, idempotent. ASCII only (WIN1252 embedded-pg). Existing rows default to
-- a plain count, so v1 plans keep working unchanged.

ALTER TABLE tier_requirements
  ADD COLUMN IF NOT EXISTS kind                    text    NOT NULL DEFAULT 'count',
  ADD COLUMN IF NOT EXISTS secondary_label         text,
  ADD COLUMN IF NOT EXISTS secondary_unit          text,
  ADD COLUMN IF NOT EXISTS secondary_threshold     integer,
  ADD COLUMN IF NOT EXISTS secondary_current_value integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS note                    text    NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS informational           boolean NOT NULL DEFAULT false;
