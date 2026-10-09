import { useCallback, useEffect, useMemo, useState } from 'react'
import { IS_DEMO } from './config.js'
import { shortDate } from './dates.js'
import { DEFAULT_PRIOR } from './bandit.js'
import {
  loadOptions,
  loadRatings,
  addOption,
  updateOption,
  deleteOption,
  deleteRating,
  clearRatingsAndAssignments,
  clearEverything,
  posteriorsFor,
  ratingsToCsv,
} from './data.js'
import { forgetAuth } from './PinGate.jsx'
import { DEMO_OPTIONS, DEMO_RATINGS } from './fixtures.js'
import { MAIN_HREF } from './links.js'

const PRIOR_FIELDS = [
  { key: 'prior_mu', label: 'μ₀', hint: 'prior mean rating' },
  { key: 'prior_lambda', label: 'λ₀', hint: 'prior strength, in pseudo-observations' },
  { key: 'prior_alpha', label: 'α₀', hint: 'shape; keep above 1' },
  { key: 'prior_beta', label: 'β₀', hint: 'scale; E[σ²] = β₀/(α₀−1)' },
]

/** Destructive action behind a typed confirmation rather than window.confirm. */
function DangerAction({ label, description, phrase, onConfirm, busy }) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')

  if (!open) {
    return (
      <div className="danger-row">
        <div>
          <strong>{label}</strong>
          <p className="hint">{description}</p>
        </div>
        <button className="btn btn-danger" onClick={() => setOpen(true)} disabled={busy}>
          {label}
        </button>
      </div>
    )
  }

  return (
    <div className="danger-row danger-open">
      <div>
        <strong>{label}</strong>
        <p className="hint">
          This cannot be undone. Type <code>{phrase}</code> to confirm.
        </p>
        <input
          className="input"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={phrase}
          autoFocus
        />
      </div>
      <div className="danger-actions">
        <button
          className="btn btn-danger"
          disabled={typed !== phrase || busy}
          onClick={async () => {
            await onConfirm()
            setOpen(false)
            setTyped('')
          }}
        >
          Confirm
        </button>
        <button
          className="btn"
          onClick={() => {
            setOpen(false)
            setTyped('')
          }}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

export default function EditApp() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)

  const [options, setOptions] = useState([])
  const [ratings, setRatings] = useState([])

  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState({})
  const [newName, setNewName] = useState('')

  const flash = useCallback((text, type = 'ok') => {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 3000)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (IS_DEMO) {
        setOptions(DEMO_OPTIONS)
        setRatings(DEMO_RATINGS)
        return
      }
      const [opts, rats] = await Promise.all([loadOptions(), loadRatings()])
      setOptions(opts)
      setRatings(rats)
    } catch (e) {
      setError(e.message ?? String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const posteriors = useMemo(() => posteriorsFor(options, ratings), [options, ratings])
  const countsByOption = useMemo(() => {
    const m = new Map()
    for (const r of ratings) m.set(String(r.option_id), (m.get(String(r.option_id)) ?? 0) + 1)
    return m
  }, [ratings])

  const guardDemo = () => {
    if (IS_DEMO) {
      flash('Demo mode — nothing is saved.', 'error')
      return true
    }
    return false
  }

  const startEdit = (o) => {
    setEditingId(o.id)
    setDraft({
      name: o.name,
      sort_order: o.sort_order ?? '',
      prior_mu: o.prior_mu ?? DEFAULT_PRIOR.mu,
      prior_lambda: o.prior_lambda ?? DEFAULT_PRIOR.lambda,
      prior_alpha: o.prior_alpha ?? DEFAULT_PRIOR.alpha,
      prior_beta: o.prior_beta ?? DEFAULT_PRIOR.beta,
    })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setDraft({})
  }

  const saveEdit = async (id) => {
    if (guardDemo()) return
    if (!String(draft.name ?? '').trim()) {
      flash('Name cannot be empty.', 'error')
      return
    }
    const alpha = Number(draft.prior_alpha)
    if (!(alpha > 1)) {
      flash('α₀ must be greater than 1, or the variance has no mean.', 'error')
      return
    }
    if (!(Number(draft.prior_lambda) > 0) || !(Number(draft.prior_beta) > 0)) {
      flash('λ₀ and β₀ must be greater than 0.', 'error')
      return
    }

    setBusy(true)
    try {
      await updateOption(id, {
        name: String(draft.name).trim(),
        sort_order: draft.sort_order === '' ? null : Number(draft.sort_order),
        prior_mu: Number(draft.prior_mu),
        prior_lambda: Number(draft.prior_lambda),
        prior_alpha: alpha,
        prior_beta: Number(draft.prior_beta),
      })
      setOptions(await loadOptions())
      cancelEdit()
      flash('Saved.')
    } catch (e) {
      flash(`Error: ${e.message ?? e}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const toggleActive = async (o) => {
    if (guardDemo()) return
    setBusy(true)
    try {
      await updateOption(o.id, { active: !o.active })
      setOptions(await loadOptions())
      flash(o.active ? `Paused ${o.name}.` : `Resumed ${o.name}.`)
    } catch (e) {
      flash(`Error: ${e.message ?? e}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const removeOption = async (o) => {
    if (guardDemo()) return
    const n = countsByOption.get(String(o.id)) ?? 0
    const warning =
      n > 0
        ? `Delete "${o.name}" and its ${n} rating${n === 1 ? '' : 's'}? Pausing keeps the data.`
        : `Delete "${o.name}"?`
    if (!window.confirm(warning)) return

    setBusy(true)
    try {
      await deleteOption(o.id)
      const [opts, rats] = await Promise.all([loadOptions(), loadRatings()])
      setOptions(opts)
      setRatings(rats)
      flash('Deleted.')
    } catch (e) {
      flash(`Error: ${e.message ?? e}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const create = async (e) => {
    e.preventDefault()
    if (guardDemo()) return
    if (!newName.trim()) return
    setBusy(true)
    try {
      await addOption({ name: newName, sortOrder: options.length })
      setNewName('')
      setOptions(await loadOptions())
      flash('Added.')
    } catch (e2) {
      flash(`Error: ${e2.message ?? e2}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const removeRating = async (r) => {
    if (guardDemo()) return
    if (!window.confirm(`Delete the rating from ${shortDate(r.rated_on)}?`)) return
    setBusy(true)
    try {
      await deleteRating(r.id)
      setRatings(await loadRatings())
      flash('Deleted.')
    } catch (e) {
      flash(`Error: ${e.message ?? e}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const exportCsv = () => {
    const csv = ratingsToCsv(ratings, options)
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `commute-ratings-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  if (loading) return <div className="edit-app">Loading…</div>

  const nameById = new Map(options.map((o) => [String(o.id), o.name]))

  return (
    <div className="edit-app">
      <header className="edit-head">
        <h1>Commute — Edit</h1>
        {message && <span className={`edit-message ${message.type}`}>{message.text}</span>}
      </header>

      {error && <div className="edit-message error block">{error}</div>}
      {IS_DEMO && <div className="edit-message error block">Demo mode — nothing is saved.</div>}

      <section>
        <h2>Options</h2>
        <p className="hint">
          Pausing takes an option out of the draw but keeps its ratings. Deleting removes the
          ratings too — prefer pause unless you're sure.
        </p>

        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th className="num">n</th>
              <th className="num">mean</th>
              <th>In draw</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {options.map((o) =>
              editingId === o.id ? (
                <tr key={o.id} className="editing">
                  <td colSpan={5}>
                    <div className="edit-grid">
                      <label>
                        <span>Name</span>
                        <input
                          className="input"
                          value={draft.name}
                          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEdit(o.id)
                            if (e.key === 'Escape') cancelEdit()
                          }}
                          autoFocus
                        />
                      </label>
                      <label>
                        <span>Order</span>
                        <input
                          className="input short"
                          type="number"
                          value={draft.sort_order}
                          onChange={(e) => setDraft({ ...draft, sort_order: e.target.value })}
                        />
                      </label>
                      {PRIOR_FIELDS.map((f) => (
                        <label key={f.key} title={f.hint}>
                          <span>{f.label}</span>
                          <input
                            className="input short"
                            type="number"
                            step="0.1"
                            value={draft[f.key]}
                            onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                          />
                        </label>
                      ))}
                    </div>
                    <p className="hint">
                      The prior is your belief before any data. λ₀ is how many days of evidence
                      it's worth — λ₀ = 1 is a gentle nudge, λ₀ = 10 is a strong opinion.
                    </p>
                    <div className="row-actions">
                      <button className="btn btn-primary" onClick={() => saveEdit(o.id)} disabled={busy}>
                        Save
                      </button>
                      <button className="btn" onClick={cancelEdit} disabled={busy}>
                        Cancel
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={o.id} className={o.active ? '' : 'paused'}>
                  <td>{o.name}</td>
                  <td className="num">{countsByOption.get(String(o.id)) ?? 0}</td>
                  <td className="num">
                    {(countsByOption.get(String(o.id)) ?? 0) > 0
                      ? posteriors.get(o.id).mu.toFixed(2)
                      : '–'}
                  </td>
                  <td>
                    <button className="toggle" onClick={() => toggleActive(o)} disabled={busy}>
                      {o.active ? 'yes' : 'paused'}
                    </button>
                  </td>
                  <td className="row-actions">
                    <button className="btn" onClick={() => startEdit(o)} disabled={busy}>
                      Edit
                    </button>
                    <button className="btn btn-danger" onClick={() => removeOption(o)} disabled={busy}>
                      Delete
                    </button>
                  </td>
                </tr>
              )
            )}
            {options.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">
                  No options yet. Add the ways you might commute below.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <form className="add-form" onSubmit={create}>
          <input
            className="input"
            placeholder="e.g. Bike, BART, Drive, Bus + walk"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button className="btn btn-primary" type="submit" disabled={!newName.trim() || busy}>
            Add
          </button>
        </form>
      </section>

      <section>
        <h2>Ratings ({ratings.length})</h2>
        {ratings.length > 0 ? (
          <>
            <button className="btn" onClick={exportCsv}>
              Export CSV
            </button>
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Option</th>
                  <th className="num">Rating</th>
                  <th>Note</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {ratings.map((r) => (
                  <tr key={r.id}>
                    <td>{shortDate(r.rated_on)}</td>
                    <td>{nameById.get(String(r.option_id)) ?? '—'}</td>
                    <td className="num">{r.rating}</td>
                    <td className="note">{r.notes ?? ''}</td>
                    <td className="row-actions">
                      <button className="btn btn-danger" onClick={() => removeRating(r)} disabled={busy}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p className="hint">Nothing rated yet.</p>
        )}
      </section>

      <section className="danger-zone">
        <h2>Danger zone</h2>
        <DangerAction
          label="Clear trial data"
          description="Deletes every rating and daily assignment. Keeps your options and their priors, so you can start a fresh trial."
          phrase="CLEAR"
          busy={busy}
          onConfirm={async () => {
            if (guardDemo()) return
            setBusy(true)
            try {
              await clearRatingsAndAssignments()
              setRatings(await loadRatings())
              flash('Trial data cleared.')
            } catch (e) {
              flash(`Error: ${e.message ?? e}`, 'error')
            } finally {
              setBusy(false)
            }
          }}
        />
        <DangerAction
          label="Delete everything"
          description="Deletes the options as well. The pages will be empty afterwards."
          phrase="DELETE EVERYTHING"
          busy={busy}
          onConfirm={async () => {
            if (guardDemo()) return
            setBusy(true)
            try {
              await clearEverything()
              const [opts, rats] = await Promise.all([loadOptions(), loadRatings()])
              setOptions(opts)
              setRatings(rats)
              flash('Everything deleted.')
            } catch (e) {
              flash(`Error: ${e.message ?? e}`, 'error')
            } finally {
              setBusy(false)
            }
          }}
        />
      </section>

      <footer className="edit-foot">
        <a href={MAIN_HREF}>Back to today</a>
        <button
          className="link-button"
          onClick={() => {
            forgetAuth()
            window.location.reload()
          }}
        >
          Lock
        </button>
      </footer>
    </div>
  )
}
