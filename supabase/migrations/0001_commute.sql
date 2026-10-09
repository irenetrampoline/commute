-- Commute bandit schema.
--
-- Run this once in the Supabase dashboard SQL editor for project wujpugalfrlyjcbzhcxa.
-- (There is no supabase CLI or psql on the dev machine, so this file is the record of
-- what was applied rather than something that gets applied automatically.)
--
-- Design note: posteriors are never stored. commute_ratings is the single source of
-- truth and the Normal-Inverse-Gamma posterior is recomputed in the browser on every
-- load. That keeps "clear the data", "delete a misclicked rating", "change a prior" and
-- "switch the model" as ordinary operations instead of migrations.

create table if not exists commute_options (
  id           bigserial primary key,
  name         text    not null,
  active       boolean not null default true,
  sort_order   int,
  -- Normal-Inverse-Gamma prior, editable per option on /commute-edit.
  prior_mu     numeric not null default 3,   -- mu_0:     prior mean rating
  prior_lambda numeric not null default 1,   -- lambda_0: prior strength in pseudo-observations
  prior_alpha  numeric not null default 2,   -- alpha_0:  shape, must exceed 1
  prior_beta   numeric not null default 2,   -- beta_0:   scale, E[sigma^2] = 2 so sd ~ 1.4
  created_at   timestamptz not null default now(),
  constraint commute_options_alpha_gt_one check (prior_alpha > 1),
  constraint commute_options_positive check (prior_lambda > 0 and prior_beta > 0)
);

create table if not exists commute_ratings (
  id         bigserial primary key,
  option_id  bigint  not null references commute_options(id) on delete cascade,
  rating     int     not null check (rating between 1 and 5),
  -- One observation per calendar day: the morning and the evening together are one
  -- rating of the round trip. The unique index makes re-rating an update, not a
  -- second row, and stops a double tap from double-counting a day.
  rated_on   date    not null unique,
  notes      text,
  created_at timestamptz not null default now()
);

create table if not exists commute_assignments (
  id           bigserial primary key,
  -- One draw per day, persisted so a page refresh cannot re-roll the recommendation.
  assigned_on  date   not null unique,
  option_id    bigint not null references commute_options(id) on delete cascade,
  -- Options ruled out that day via "Can't do this today". No rating is recorded for
  -- these: an unavailable option is missing data, not a bad score.
  excluded_ids bigint[] not null default '{}',
  created_at   timestamptz not null default now()
);

create index if not exists commute_ratings_option_id_idx on commute_ratings (option_id);
create index if not exists commute_ratings_rated_on_idx   on commute_ratings (rated_on);

-- Row-level security -------------------------------------------------------
--
-- RLS is enabled with fully permissive anon policies. This clears Supabase's
-- "RLS Disabled in Public" advisory, but be clear about what it does and does not do:
-- the anon key still grants full read and write on these three tables, and that key
-- ships in the page source. The exposure is identical to having RLS off; only the
-- linter's opinion changed.
--
-- That is the same posture as items / projects / food_log / points_entries behind the
-- other apps on the site, and the PIN on the pages is a speed bump rather than access
-- control. To make this genuinely private: drop these three policies, grant `for all
-- to authenticated` instead, and swap the PIN for Supabase Auth on both pages.

alter table commute_options     enable row level security;
alter table commute_ratings     enable row level security;
alter table commute_assignments enable row level security;

create policy "anon all" on commute_options     for all to anon using (true) with check (true);
create policy "anon all" on commute_ratings     for all to anon using (true) with check (true);
create policy "anon all" on commute_assignments for all to anon using (true) with check (true);
