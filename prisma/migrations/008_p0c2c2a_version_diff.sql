insert into public.schema_migrations(version)
values ('p0c2c2a_version_diff_008')
on conflict (version) do nothing;
