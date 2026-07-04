-- 0052: saved executive narrative on reports.
-- A graph-grounded, optionally AI-polished narrative drafted while the report is in
-- the draft state; it survives review -> approve -> export and renders on the detail
-- page and the print/QBR packet. Regenerating the snapshot clears it (it would be
-- stale). Text column with an empty-string default keeps every existing report valid.

ALTER TABLE reports ADD COLUMN IF NOT EXISTS narrative text NOT NULL DEFAULT '';
