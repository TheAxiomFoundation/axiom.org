-- Document classification is derived from the same bytes served by the mirror.
-- It is not a promise of compilation, certification, or legal correctness.
alter table encodings.rulespec_files
  add column if not exists raw_yaml_sha256 text,
  add column if not exists execution_kind text,
  add column if not exists classification_yaml_sha256 text;

alter table encodings.rulespec_files
  add constraint rulespec_files_execution_kind_check
    check (execution_kind in ('provision', 'composition', 'program', 'unknown')),
  add constraint rulespec_files_classification_identity_check
    check ((execution_kind is null and classification_yaml_sha256 is null)
      or (execution_kind is not null and classification_yaml_sha256 is not null
        and raw_yaml_sha256 is not null
        and classification_yaml_sha256 = raw_yaml_sha256));

-- Older writers may update raw_yaml without classification fields. Invalidate
-- stale classification atomically rather than serving the previous kind.
create or replace function encodings.invalidate_stale_rulespec_classification()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  new.raw_yaml_sha256 := encode(sha256(convert_to(new.raw_yaml, 'UTF8')), 'hex');
  if new.classification_yaml_sha256 is distinct from new.raw_yaml_sha256
      or new.execution_kind is null then
    new.execution_kind := null;
    new.classification_yaml_sha256 := null;
  end if;
  return new;
end;
$$;

create trigger rulespec_files_classification_identity
before insert or update on encodings.rulespec_files
for each row execute function encodings.invalidate_stale_rulespec_classification();

-- Existing rows remain unclassified until a supported sync parses their YAML.
update encodings.rulespec_files
set raw_yaml_sha256 = encode(sha256(convert_to(raw_yaml, 'UTF8')), 'hex');
