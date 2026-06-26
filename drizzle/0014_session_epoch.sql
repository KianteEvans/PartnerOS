-- Session revocation. Each user carries a session_epoch that is embedded in
-- their signed session JWT at login. The per-request identity check
-- (assertActiveUser) compares the token's epoch to this column; bumping it
-- invalidates every outstanding token for that user (force re-login) without
-- deleting or disabling the account. Existing tokens predating this column
-- carry epoch 0 (the zod default), which matches the default below — no forced
-- re-login on deploy.
ALTER TABLE users
  ADD COLUMN session_epoch integer NOT NULL DEFAULT 0;
