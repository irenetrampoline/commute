import { useCallback, useEffect, useMemo, useState } from 'react'
import { IS_DEMO } from './config.js'
import { localDate, prettyDate, shortDate } from './dates.js'
import { credibleInterval, clampToScale, expectedVariance } from './bandit.js'
import {
  loadOptions,
  loadRatings,
  getOrCreateAssignment,
  redrawExcludingCurrent,
  saveRating,
  deleteRating,
  posteriorsFor,
} from './data.js'
import { DEMO_OPTIONS, DEMO_RATINGS, DEMO_ASSIGNMENT } from './fixtures.js'
import { EDIT_HREF } from './links.js'

const RATING_LABELS = {
  1: 'awful',
  2: 'bad',
  3: 'fine',
  4: 'good',
  5: 'great',
}

/** Position on the 1-5 track, as a percentage. */
function pct(x) {
  return ((clampToScale(x) - 1) / 4) * 100
}

function StandingsRow({ option, post, isToday }) {
  const [lo, hi] = useMemo(
    // Seed off the option id so the interval is stable across re-renders.
    () => credibleInterval(post, { seed: 1000 + Number(option.id) }),
    [post, option.id]
  )
  const mean = post.mu
  const sd = Math.sqrt(expectedVariance(post))
  const hasData = post.n > 0

  const detail = hasData
    ? `${option.name}: posterior mean ${mean.toFixed(2)}, 95% interval ${lo.toFixed(2)}–${hi.toFixed(
        2
      )}, spread (sd) ${sd.toFixed(2)}, from ${post.n} ${post.n === 1 ? 'day' : 'days'}`
    : `${option.name}: no data yet, showing the prior`

  return (
    <div className={`srow${hasData ? '' : ' srow-empty'}`} title={detail}>
      <div className="srow-name">
        {option.name}
        {isToday && <span className="badge badge-today">today</span>}
        {!option.active && <span className="badge badge-paused">paused</span>}
      </div>

      <div className="track" role="img" aria-label={detail}>
        <div className="track-grid">
          {[1, 2, 3, 4, 5].map((t) => (
            <span key={t} className="tick" style={{ left: `${pct(t)}%` }} />
          ))}
        </div>
        <div
          className="whisker"
          style={{ left: `${pct(lo)}%`, width: `${Math.max(0, pct(hi) - pct(lo))}%` }}
        />
        <div className="dot" style={{ left: `${pct(mean)}%` }} />
      </div>

      <div className="srow-mean">{hasData ? mean.toFixed(1) : '–'}</div>
      <div className="srow-n">{post.n}</div>
    </div>
  )
}

function Standings({ options, posteriors, todayOptionId }) {
  if (options.length === 0) return null

  // Best-first, so the current answer is at the top where you'll look.
  const ordered = [...options].sort((a, b) => {
    const pa = posteriors.get(a.id)
    const pb = posteriors.get(b.id)
    return pb.mu - pa.mu
  })

  return (
    <section className="card">
      <h2 className="card-title">Where things stand</h2>
      <p className="card-sub">
        Posterior mean with a 95% credible interval, on the 1–5 scale. Wider means less
        certain, which is what earns an option another try.
      </p>

      <div className="srow srow-head" aria-hidden="true">
        <div className="srow-name" />
        <div className="track track-axis">
          {[1, 2, 3, 4, 5].map((t) => (
            <span key={t} className="axis-label" style={{ left: `${pct(t)}%` }}>
              {t}
            </span>
          ))}
        </div>
        <div className="srow-mean">mean</div>
        <div className="srow-n">n</div>
      </div>

      {ordered.map((o) => (
        <StandingsRow
          key={o.id}
          option={o}
          post={posteriors.get(o.id)}
          isToday={String(o.id) === String(todayOptionId)}
        />
      ))}
    </section>
  )
}

function History({ ratings, options }) {
  if (ratings.length === 0) return null
  const nameById = new Map(options.map((o) => [String(o.id), o.name]))
  const recent = ratings.slice(0, 14)

  return (
    <section className="card">
      <h2 className="card-title">Recent days</h2>
      <table className="history">
        <tbody>
          {recent.map((r) => (
            <tr key={r.id}>
              <td className="h-date">{shortDate(r.rated_on)}</td>
              <td className="h-name">{nameById.get(String(r.option_id)) ?? '—'}</td>
              <td className="h-rating">
                {r.rating}
                <span className="h-word">{RATING_LABELS[r.rating]}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

export default function App() {
  const today = localDate()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)

  const [options, setOptions] = useState([])
  const [ratings, setRatings] = useState([])
  const [assignment, setAssignment] = useState(null)
  const [notes, setNotes] = useState('')

  const flash = useCallback((text) => {
    setStatus(text)
    setTimeout(() => setStatus(null), 3000)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (IS_DEMO) {
        setOptions(DEMO_OPTIONS)
        setRatings(DEMO_RATINGS)
        setAssignment(DEMO_ASSIGNMENT)
        return
      }
      const [opts, rats] = await Promise.all([loadOptions(), loadRatings()])
      setOptions(opts)
      setRatings(rats)
      setAssignment(await getOrCreateAssignment(today, opts, rats))
    } catch (e) {
      setError(e.message ?? String(e))
    } finally {
      setLoading(false)
    }
  }, [today])

  useEffect(() => {
    load()
  }, [load])

  const posteriors = useMemo(() => posteriorsFor(options, ratings), [options, ratings])
  const todayRating = useMemo(
    () => ratings.find((r) => r.rated_on === today) ?? null,
    [ratings, today]
  )
  /**
   * Derived rather than held in state, so it survives a reload. When every option has
   * been ruled out, the stored assignment keeps its last option_id and that id also
   * appears in excluded_ids - which is the signal. Tracking this in local state meant a
   * refresh showed the last-rejected option as the day's pick while simultaneously
   * listing it as ruled out.
   */
  const exhausted = useMemo(() => {
    if (!assignment) return false
    const excluded = (assignment.excluded_ids ?? []).map(String)
    return excluded.includes(String(assignment.option_id))
  }, [assignment])

  const currentOption = useMemo(
    () =>
      exhausted
        ? null
        : options.find((o) => String(o.id) === String(assignment?.option_id)) ?? null,
    [options, assignment, exhausted]
  )
  const activeCount = options.filter((o) => o.active).length

  const rate = async (value) => {
    if (!assignment || busy) return
    setBusy(true)
    try {
      if (IS_DEMO) {
        flash('Demo mode — nothing saved.')
        return
      }
      await saveRating({
        date: today,
        optionId: assignment.option_id,
        rating: value,
        notes,
      })
      setNotes('')
      setRatings(await loadRatings())
      flash('Saved.')
    } catch (e) {
      setError(e.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  const undo = async () => {
    if (!todayRating || busy) return
    setBusy(true)
    try {
      if (IS_DEMO) {
        flash('Demo mode — nothing changed.')
        return
      }
      await deleteRating(todayRating.id)
      setRatings(await loadRatings())
      flash('Cleared today’s rating.')
    } catch (e) {
      setError(e.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  const cannotDo = async () => {
    if (!assignment || busy) return
    setBusy(true)
    try {
      if (IS_DEMO) {
        flash('Demo mode — nothing changed.')
        return
      }
      const res = await redrawExcludingCurrent(assignment, options, ratings)
      setAssignment(res.assignment)
      flash(res.exhausted ? 'Nothing left to try today.' : 'Picked something else.')
    } catch (e) {
      setError(e.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="app">
        <p className="loading">Loading…</p>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="head">
        <h1 className="title">Commute</h1>
        <p className="date">{prettyDate(today)}</p>
        {IS_DEMO && <p className="demo-note">Demo data — no database, nothing saved.</p>}
      </header>

      {error && (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      )}
      {status && <div className="banner banner-ok">{status}</div>}

      {activeCount === 0 ? (
        <section className="card">
          <h2 className="card-title">No options yet</h2>
          <p className="card-sub">
            Add the ways you might commute on the{' '}
            <a href={EDIT_HREF}>edit page</a>, then come back.
          </p>
        </section>
      ) : (
        <section className="card card-today">
          <h2 className="card-title">Today</h2>

          {currentOption ? (
            <p className="pick">{currentOption.name}</p>
          ) : (
            <p className="pick pick-none">—</p>
          )}

          {assignment?.excluded_ids?.length > 0 && (
            <p className="excluded">
              Ruled out today:{' '}
              {assignment.excluded_ids
                .map((id) => options.find((o) => String(o.id) === String(id))?.name ?? id)
                .join(', ')}
            </p>
          )}

          {todayRating ? (
            <div className="rated">
              <p className="rated-line">
                You rated it <strong>{todayRating.rating}/5</strong>{' '}
                <span className="h-word">{RATING_LABELS[todayRating.rating]}</span>
              </p>
              {todayRating.notes && <p className="rated-notes">“{todayRating.notes}”</p>}
              <button className="link-button" onClick={undo} disabled={busy}>
                Change it
              </button>
            </div>
          ) : exhausted ? (
            <p className="card-sub">
              Every option is ruled out for today. Nothing recorded — try again tomorrow.
            </p>
          ) : (
            <div className="rate">
              <p className="rate-q">How did it go?</p>
              <div className="rate-buttons">
                {[1, 2, 3, 4, 5].map((v) => (
                  <button
                    key={v}
                    className="rate-btn"
                    onClick={() => rate(v)}
                    disabled={busy}
                    aria-label={`${v} out of 5, ${RATING_LABELS[v]}`}
                  >
                    <span className="rate-num">{v}</span>
                    <span className="rate-word">{RATING_LABELS[v]}</span>
                  </button>
                ))}
              </div>
              <input
                className="notes"
                type="text"
                placeholder="Note (optional)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={280}
              />
              <button className="link-button" onClick={cannotDo} disabled={busy}>
                Can’t do this today
              </button>
            </div>
          )}
        </section>
      )}

      <Standings
        options={options}
        posteriors={posteriors}
        todayOptionId={assignment?.option_id}
      />

      <History ratings={ratings} options={options} />

      <footer className="foot">
        <a href={EDIT_HREF}>Edit options</a>
      </footer>
    </div>
  )
}
