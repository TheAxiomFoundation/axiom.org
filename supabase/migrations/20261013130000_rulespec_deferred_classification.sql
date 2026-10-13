-- Extend the existing digest-bound document classification; do not alter YAML
-- or classify existing rows without the normal publisher parsing their bytes.
alter table encodings.rulespec_files
  drop constraint rulespec_files_execution_kind_check,
  add constraint rulespec_files_execution_kind_check
    check (execution_kind in ('provision', 'composition', 'program', 'deferred', 'unknown'));
