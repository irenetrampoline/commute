// All Supabase access lives here, so the components stay about rendering and the
// bandit module stays pure.

import { supabase } from './supabase.js'
import { posteriorFromRatings, thompsonPick, DEFAULT_PRIOR } from './bandit.js'

/**
 * Postgres `numeric` can come back as a string to preserve precision, so never feed
 * these straight into arithmetic.
 */
export function priorOf(option) {
  return {
    mu: Number(option.prior_mu ?? DEFAULT_PRIOR.mu),
    lambda: Number(option.prior_lambda ?? DEFAULT_PRIOR.lambda),
    alpha: Number(option.prior_alpha ?? DEFAULT_PRIOR.alpha),
    beta: Number(option.prior_beta ?? DEFAULT_PRIOR.beta),
  }
}

/** option_id -> array of ratings */
export function ratingsByOption(ratings) {
  const map = new Map()
  for (const r of ratings) {
    const list = map.get(r.option_id)
    if (list) list.push(r.rating)
    else map.set(r.option_id, [r.rating])
  }
  return map
}

/** Posterior per option, including inactive ones (the table still shows them). */
export function posteriorsFor(options, ratings) {
  const byOption = ratingsByOption(ratings)
  const out = new Map()
  for (const o of options) {
    out.set(o.id, posteriorFromRatings(priorOf(o), byOption.get(o.id) ?? []))
  }
  return out
}

/** Candidate arms for a draw: active, and not already ruled out today. */
export function buildArms(options, ratings, excludedIds = []) {
  const excluded = new Set((excludedIds ?? []).map(Number))
  const byOption = ratingsByOption(ratings)
  return options
    .filter((o) => o.active && !excluded.has(Number(o.id)))
    .map((o) => ({
      id: o.id,
      posterior: posteriorFromRatings(priorOf(o), byOption.get(o.id) ?? []),
    }))
}

export function sortOptions(options) {
  // sort_order first when set, then name - mirrors how radish sorts client-side.
  return [...options].sort((a, b) => {
    const ao = a.sort_order ?? Number.MAX_SAFE_INTEGER
    const bo = b.sort_order ?? Number.MAX_SAFE_INTEGER
    if (ao !== bo) return ao - bo
    return String(a.name).localeCompare(String(b.name))
  })
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function loadOptions() {
  const { data, error } = await supabase.from('commute_options').select('*')
  if (error) throw error
  return sortOptions(data ?? [])
}

export async function loadRatings() {
  const { data, error } = await supabase
    .from('commute_ratings')
    .select('*')
    .order('rated_on', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function loadAssignment(date) {
  const { data, error } = await supabase
    .from('commute_assignments')
    .select('*')
    .eq('assigned_on', date)
    .maybeSingle()
  if (error) throw error
  return data ?? null
}

export async function loadAssignments(limit = 30) {
  const { data, error } = await supabase
    .from('commute_assignments')
    .select('*')
    .order('assigned_on', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data ?? []
}

// ---------------------------------------------------------------------------
// The daily draw
// ---------------------------------------------------------------------------

/**
 * Read today's assignment, or draw one and persist it.
 *
 * Persisting matters: without a stored row, every page load would re-sample and show a
 * different commute, so you could refresh until you got the answer you wanted. That
 * would quietly turn the experiment into a preference survey.
 *
 * The unique index on assigned_on also makes this safe across two open tabs - the loser
 * of the race gets a 23505 and re-reads the winner's row rather than overwriting it.
 */
export async function getOrCreateAssignment(date, options, ratings) {
  const existing = await loadAssignment(date)
  if (existing) return existing

  const arms = buildArms(options, ratings, [])
  const pick = thompsonPick(arms)
  if (!pick) return null

  const { data, error } = await supabase
    .from('commute_assignments')
    .insert({ assigned_on: date, option_id: pick.id, excluded_ids: [] })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      const raced = await loadAssignment(date)
      if (raced) return raced
    }
    throw error
  }
  return data
}

/**
 * Mark today's option unavailable and draw a replacement from what's left.
 * No rating is written - an unavailable day is missing data, not a bad score.
 *
 * @returns {{assignment: object|null, exhausted: boolean}}
 */
export async function redrawExcludingCurrent(assignment, options, ratings) {
  const excluded = [...(assignment.excluded_ids ?? []), assignment.option_id]
  const arms = buildArms(options, ratings, excluded)
  const pick = thompsonPick(arms)

  if (!pick) {
    // Everything is ruled out. Record the exclusion so the page remembers why.
    const { data, error } = await supabase
      .from('commute_assignments')
      .update({ excluded_ids: excluded })
      .eq('id', assignment.id)
      .select()
      .single()
    if (error) throw error
    return { assignment: data, exhausted: true }
  }

  const { data, error } = await supabase
    .from('commute_assignments')
    .update({ option_id: pick.id, excluded_ids: excluded })
    .eq('id', assignment.id)
    .select()
    .single()
  if (error) throw error
  return { assignment: data, exhausted: false }
}

// ---------------------------------------------------------------------------
// Ratings
// ---------------------------------------------------------------------------

/**
 * One rating per calendar day (morning and evening together are one observation),
 * enforced by a unique index on rated_on. Read-then-insert-or-update rather than
 * upsert, matching the idiom already used in the food app.
 */
export async function saveRating({ date, optionId, rating, notes }) {
  const { data: existing, error: readError } = await supabase
    .from('commute_ratings')
    .select('id')
    .eq('rated_on', date)
    .maybeSingle()
  if (readError) throw readError

  const row = {
    option_id: optionId,
    rating,
    rated_on: date,
    notes: notes?.trim() ? notes.trim() : null,
  }

  if (existing) {
    const { data, error } = await supabase
      .from('commute_ratings')
      .update(row)
      .eq('id', existing.id)
      .select()
      .single()
    if (error) throw error
    return data
  }

  const { data, error } = await supabase.from('commute_ratings').insert(row).select().single()
  if (error) throw error
  return data
}

export async function deleteRating(id) {
  const { error } = await supabase.from('commute_ratings').delete().eq('id', id)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Options CRUD (edit page)
// ---------------------------------------------------------------------------

export async function addOption({ name, sortOrder }) {
  const { data, error } = await supabase
    .from('commute_options')
    .insert({ name: name.trim(), sort_order: sortOrder ?? null })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateOption(id, patch) {
  const { data, error } = await supabase
    .from('commute_options')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteOption(id) {
  // ON DELETE CASCADE takes the option's ratings and assignments with it.
  const { error } = await supabase.from('commute_options').delete().eq('id', id)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Destructive bulk actions (edit page)
// ---------------------------------------------------------------------------

/** Wipe the trial data but keep the options and their priors. */
export async function clearRatingsAndAssignments() {
  const r = await supabase.from('commute_ratings').delete().neq('id', -1)
  if (r.error) throw r.error
  const a = await supabase.from('commute_assignments').delete().neq('id', -1)
  if (a.error) throw a.error
}

/** Wipe everything, options included. */
export async function clearEverything() {
  await clearRatingsAndAssignments()
  const o = await supabase.from('commute_options').delete().neq('id', -1)
  if (o.error) throw o.error
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export function ratingsToCsv(ratings, options) {
  const nameById = new Map(options.map((o) => [String(o.id), o.name]))
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = ['rated_on', 'option_id', 'option_name', 'rating', 'notes', 'created_at']
  const rows = [...ratings]
    .sort((a, b) => a.rated_on.localeCompare(b.rated_on))
    .map((r) =>
      [
        r.rated_on,
        r.option_id,
        nameById.get(String(r.option_id)) ?? '',
        r.rating,
        r.notes ?? '',
        r.created_at ?? '',
      ]
        .map(esc)
        .join(',')
    )
  return [header.join(','), ...rows].join('\n')
}
