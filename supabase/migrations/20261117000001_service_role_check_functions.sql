-- Job Radar scans (and any other server job) write as `service_role`. CHECK constraints call
-- private.valid_terms / private.valid_tags, and Postgres checks EXECUTE on those functions for the
-- writing role, so the scan failed with "permission denied for function valid_terms" when it updated
-- market_hunts.last_scanned_at. Both functions are pure validators with no side effects.

grant execute on function private.valid_terms(text[]) to service_role;
grant execute on function private.valid_tags(text[]) to service_role;
