-- 002b_oauth_cleanup.sql
-- Destructive cleanup for the old internal OAuth broker/session design.
--
-- Run only after:
--   1. the new JWT-based sync-server is deployed everywhere you care about
--   2. production has already converged on the additive auth model
--
-- Safe to re-run.

DROP TABLE IF EXISTS auth_device_requests CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS auth_accounts CASCADE;
