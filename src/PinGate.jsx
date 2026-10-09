import { useState } from 'react'
import { PIN, AUTH_STORAGE_KEY, IS_DEMO } from './config.js'

// localStorage throws in some private-browsing modes, so every access is guarded.
function readAuth() {
  if (IS_DEMO) return true
  try {
    return localStorage.getItem(AUTH_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function writeAuth() {
  try {
    localStorage.setItem(AUTH_STORAGE_KEY, 'true')
  } catch {
    // Session-only access is a fine fallback; the gate still held for this load.
  }
}

export function forgetAuth() {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY)
  } catch {
    /* nothing to do */
  }
}

export default function PinGate({ children, title = 'Commute' }) {
  const [unlocked, setUnlocked] = useState(readAuth)
  const [value, setValue] = useState('')
  const [error, setError] = useState(false)

  if (unlocked) return children

  const submit = (e) => {
    e.preventDefault()
    if (value === PIN) {
      writeAuth()
      setUnlocked(true)
    } else {
      setError(true)
      setValue('')
    }
  }

  return (
    <div className="pin-wrap">
      <form className="pin-card" onSubmit={submit}>
        <h1 className="pin-title">{title}</h1>
        <label className="pin-label" htmlFor="pin">
          PIN
        </label>
        <input
          id="pin"
          className="pin-input"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          autoFocus
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setError(false)
          }}
        />
        {error && <p className="pin-error">Not right. Try again.</p>}
        <button className="pin-button" type="submit" disabled={!value}>
          Unlock
        </button>
      </form>
    </div>
  )
}
