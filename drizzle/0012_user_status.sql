-- User lifecycle: an active/disabled status so admins can deactivate a member
-- without deleting them (preserving their audit trail and FKs). Existing rows
-- default to 'active'. Session enforcement (login + every request) rejects
-- disabled users; RLS on the users table is unchanged.
CREATE TYPE user_status AS ENUM ('active', 'disabled');

ALTER TABLE users
  ADD COLUMN status user_status NOT NULL DEFAULT 'active';
