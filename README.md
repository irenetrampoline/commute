# commute

Thompson sampling to work out the best way to get to work.

Each morning `irenechen.net/commute` names one commute option to try, you rate the day
1–5, and the posterior for that option updates. `irenechen.net/commute-edit` manages the
options and clears the data when the trial is over.

## Model

Each option is a bandit arm whose daily rating is `r ~ Normal(mu, sigma^2)`, with a
conjugate **Normal-Inverse-Gamma** prior over both unknowns. Per-arm variance is the
reason for this choice over a Beta/Bernoulli reduction: a bike commute that swings 5-1
with the weather is genuinely different from a train that is reliably 3, and the sampler
should see that difference.

Selection is textbook Thompson sampling — draw one `mu` per arm from its posterior and
play the argmax, which plays each arm in proportion to the probability it is best.

- Stationary: every observation is weighted equally, no decay.
- Draws are **not** clamped to [1,5]; a draw above 5 is real uncertainty and is what
  earns an under-sampled arm another day. Clamping happens only for display.
- Priors default to `mu_0=3, lambda_0=1, alpha_0=2, beta_0=2` and are editable per option.

All of it is in `src/bandit.js` as pure functions, with `src/bandit.test.js` covering the
update equations, the samplers' moments, and an end-to-end recovery simulation.

```sh
npm test
```

## Setup

1. `npm install`
2. Apply `supabase/migrations/0001_commute.sql` in the Supabase dashboard SQL editor.
3. **Change `PIN` in `src/config.js`** — it currently ships as `commute2026`.
4. Add your commute options at `/commute-edit`.

## Develop

```sh
npm run dev        # main page
npm run dev:edit   # edit page
```

Append `?demo` to either URL to render fixtures with no database calls at all.

## Build

```sh
npm run build
```

Writes two self-contained pages directly into the website repo:

```
../irenetrampoline.github.io/static/commute/index.html
../irenetrampoline.github.io/static/commute-edit/index.html
```

Hugo mirrors `static/` verbatim, so those become `/commute` and `/commute-edit`. Commit
and push that repo to `master` and GitHub Actions publishes it.

The build expects `irenetrampoline.github.io` to sit next to this directory.

## A note on security

The PIN is checked in client-side JavaScript and ships in the public page source, and the
Supabase anon key is public by design. This keeps crawlers and passers-by from writing
junk into the trial. It is **not** access control — anyone who reads the source or calls
the REST API directly can read and write these tables, which is already true of every
other Supabase app on the site. Real protection would mean RLS policies denying `anon`
plus Supabase Auth.
