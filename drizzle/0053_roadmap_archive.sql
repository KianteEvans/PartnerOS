-- Roadmaps gain a reversible archive: a nullable timestamp instead of a status
-- value, so draft/finalized semantics (and every status-driven query) stay
-- untouched. Archived roadmaps drop out of the default list and the Command
-- Center milestone signals; restore just clears the stamp.
ALTER TABLE roadmaps ADD COLUMN archived_at timestamptz;
