// Local-time date handling, deliberately not UTC.
//
// new Date().toISOString().slice(0,10) is the obvious thing and it is wrong here: in
// Pacific time anything after 4pm (5pm in winter) is already "tomorrow" in UTC, so an
// evening rating would land on the wrong day and could collide with the next morning's
// row. Every date in this app is a local calendar date.

/** Local calendar date as YYYY-MM-DD. */
export function localDate(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** "Thursday, October 9" from a YYYY-MM-DD string, parsed as local, not UTC. */
export function prettyDate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

/** "Thu Oct 9" - compact form for table rows. */
export function shortDate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}
