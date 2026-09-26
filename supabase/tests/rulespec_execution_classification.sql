-- Run after the classification migration. Tests touch only a temporary table.
begin;
create temporary table classification_test
  (like encodings.rulespec_files including constraints);
create trigger classification_test_identity
before insert or update on classification_test
for each row execute function encodings.invalidate_stale_rulespec_classification();

do $$
declare r record;
begin
  insert into classification_test
    (citation_path, file_path, repo, branch, jurisdiction, bucket, raw_yaml,
     search_text, synced_at, source_citation_paths, value_citation_paths,
     execution_kind, classification_yaml_sha256)
  values ('test', 'test.yaml', 'test', 'test', 'test', 'policies', 'abc',
    '', now(), '{}', '{}', 'composition',
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  select * into r from classification_test;
  if r.execution_kind is distinct from 'composition'
    or r.raw_yaml_sha256 is distinct from r.classification_yaml_sha256 then
    raise exception 'valid classification identity was not retained';
  end if;

  update classification_test set raw_yaml_sha256 = 'forged';
  select * into r from classification_test;
  if r.raw_yaml_sha256 is distinct from r.classification_yaml_sha256 then
    raise exception 'writer could forge raw YAML digest';
  end if;

  update classification_test set raw_yaml = 'changed';
  select * into r from classification_test;
  if r.execution_kind is not null or r.classification_yaml_sha256 is not null then
    raise exception 'old writer retained stale classification';
  end if;

  update classification_test set execution_kind = 'provision',
    classification_yaml_sha256 = repeat('0', 64);
  select * into r from classification_test;
  if r.execution_kind is not null or r.classification_yaml_sha256 is not null then
    raise exception 'wrong digest retained classification';
  end if;

  update classification_test set execution_kind = 'unknown',
    classification_yaml_sha256 = raw_yaml_sha256;
  select * into r from classification_test;
  if r.execution_kind is distinct from 'unknown' then
    raise exception 'explicit unknown classification was not retained';
  end if;

  begin
    update classification_test set execution_kind = 'invalid';
    raise exception 'invalid execution kind was accepted';
  exception when check_violation then
    null;
  end;

  update classification_test set raw_yaml = null;
  select * into r from classification_test;
  if r.execution_kind is not null or r.raw_yaml_sha256 is not null
    or r.classification_yaml_sha256 is not null then
    raise exception 'null source retained classification';
  end if;
end;
$$;
rollback;
