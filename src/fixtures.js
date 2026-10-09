// Fixtures for ?demo, copying the flag that the tracker app uses. With ?demo the page
// makes no Supabase calls at all, so it is safe to show someone without exposing the
// real trial or risking a stray write.

import { localDate } from './dates.js'

const daysAgo = (n) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return localDate(d)
}

export const DEMO_OPTIONS = [
  { id: 1, name: 'Bike', active: true, sort_order: 0, prior_mu: 3, prior_lambda: 1, prior_alpha: 2, prior_beta: 2 },
  { id: 2, name: 'BART', active: true, sort_order: 1, prior_mu: 3, prior_lambda: 1, prior_alpha: 2, prior_beta: 2 },
  { id: 3, name: 'Drive', active: true, sort_order: 2, prior_mu: 3, prior_lambda: 1, prior_alpha: 2, prior_beta: 2 },
  { id: 4, name: 'Bus + walk', active: true, sort_order: 3, prior_mu: 3, prior_lambda: 1, prior_alpha: 2, prior_beta: 2 },
]

const DEMO_RATING_SPEC = [
  [1, 5], [1, 4], [1, 5], [1, 5], [1, 3], [1, 4], [1, 5],
  [2, 3], [2, 4], [2, 3], [2, 3],
  [3, 2], [3, 3], [3, 2],
  [4, 2], [4, 3],
]

export const DEMO_RATINGS = DEMO_RATING_SPEC.map(([option_id, rating], i) => ({
  id: i + 1,
  option_id,
  rating,
  rated_on: daysAgo(DEMO_RATING_SPEC.length - i),
  notes: null,
  created_at: null,
}))

export const DEMO_ASSIGNMENT = {
  id: 999,
  assigned_on: localDate(),
  option_id: 1,
  excluded_ids: [],
  created_at: null,
}
