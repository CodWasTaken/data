-- Generated from schema/opportunity-v2.model.json.
-- Apply only in an isolated development database after review.
alter table if exists public.opportunities add column if not exists schema_version text;
alter table if exists public.opportunities add constraint opportunities_schema_version_v2 check (schema_version in ('1', '2.0')) not valid;
alter table if exists public.opportunities add constraint opportunities_v2_status check ((schema_version <> '2.0') or (data->'availability'->>'status' in ('open', 'rolling', 'upcoming', 'limited', 'waitlist', 'temporarily-unavailable', 'closed', 'expired', 'unconfirmed', 'disputed', 'archived'))) not valid;
alter table if exists public.opportunities add constraint opportunities_v2_resource_type check ((schema_version <> '2.0') or (data->'classification'->>'resourceType' in ('opportunity', 'resource', 'benefit', 'program', 'event', 'funding', 'fellowship', 'competition', 'community', 'learning-resource', 'public-dataset', 'general-free-product'))) not valid;
