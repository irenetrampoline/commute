// Smoke tests that actually mount the pages.
//
// These stand in for opening a browser: they catch render-time crashes, bad hook use,
// and undefined access, and they assert that the numbers reaching the screen are the
// ones the bandit module computes. They say nothing about how it looks.
//
// Both run in ?demo mode, so no Supabase client is ever constructed.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { DEFAULT_PRIOR, posteriorFromRatings } from './bandit.js'
import { DEMO_RATINGS } from './fixtures.js'

let container
let root

beforeEach(() => {
  // config.js snapshots window.location at import time, so the URL has to carry ?demo
  // before the dynamic import below. Hence no static import of App/EditApp.
  window.history.replaceState({}, '', '/?demo')
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(async () => {
  if (root) await act(async () => root.unmount())
  container?.remove()
  root = null
})

async function mount(Component) {
  root = createRoot(container)
  await act(async () => {
    root.render(<Component />)
  })
  return container
}

describe('App (/commute)', () => {
  it('mounts and renders today, the standings and the history', async () => {
    const { default: App } = await import('./App.jsx')
    const el = await mount(App)
    const text = el.textContent

    expect(text).toContain('Commute')
    expect(text).toContain('Today')
    expect(text).toContain('Where things stand')
    expect(text).toContain('Recent days')
    // The demo assignment points at Bike.
    expect(text).toContain('Bike')
    // Demo mode must announce itself so a screenshot is never mistaken for real data.
    expect(text).toContain('Demo data')
  })

  it('offers all five ratings and the escape hatch', async () => {
    const { default: App } = await import('./App.jsx')
    const el = await mount(App)

    const labels = [...el.querySelectorAll('.rate-btn')].map((b) =>
      b.querySelector('.rate-num')?.textContent
    )
    expect(labels).toEqual(['1', '2', '3', '4', '5'])
    expect(el.textContent).toContain('Can’t do this today')
  })

  it('shows the posterior mean the bandit module computes', async () => {
    const { default: App } = await import('./App.jsx')
    const el = await mount(App)

    // Bike is option_id 1 in the fixtures.
    const bikeRatings = DEMO_RATINGS.filter((r) => r.option_id === 1).map((r) => r.rating)
    const expected = posteriorFromRatings(DEFAULT_PRIOR, bikeRatings).mu.toFixed(1)

    const means = [...el.querySelectorAll('.srow-mean')].map((n) => n.textContent)
    expect(means).toContain(expected)
  })

  it('orders the standings best-first', async () => {
    const { default: App } = await import('./App.jsx')
    const el = await mount(App)

    const means = [...el.querySelectorAll('.srow:not(.srow-head) .srow-mean')]
      .map((n) => parseFloat(n.textContent))
      .filter((v) => !Number.isNaN(v))

    expect(means.length).toBeGreaterThan(1)
    for (let i = 1; i < means.length; i += 1) {
      expect(means[i]).toBeLessThanOrEqual(means[i - 1])
    }
  })

  it('keeps every interval marker inside the 1-5 track', async () => {
    const { default: App } = await import('./App.jsx')
    const el = await mount(App)

    for (const dot of el.querySelectorAll('.dot')) {
      const left = parseFloat(dot.style.left)
      expect(left).toBeGreaterThanOrEqual(0)
      expect(left).toBeLessThanOrEqual(100)
    }
    for (const w of el.querySelectorAll('.whisker')) {
      const left = parseFloat(w.style.left)
      const width = parseFloat(w.style.width)
      expect(left).toBeGreaterThanOrEqual(0)
      expect(width).toBeGreaterThanOrEqual(0)
      expect(left + width).toBeLessThanOrEqual(100.01)
    }
  })
})

describe('EditApp (/commute-edit)', () => {
  it('mounts and lists the options and ratings', async () => {
    const { default: EditApp } = await import('./EditApp.jsx')
    const el = await mount(EditApp)
    const text = el.textContent

    expect(text).toContain('Commute — Edit')
    expect(text).toContain('Options')
    expect(text).toContain('Bike')
    expect(text).toContain('BART')
    expect(text).toContain(`Ratings (${DEMO_RATINGS.length})`)
  })

  it('puts both bulk deletions behind a typed confirmation', async () => {
    const { default: EditApp } = await import('./EditApp.jsx')
    const el = await mount(EditApp)

    expect(el.textContent).toContain('Danger zone')
    const danger = [...el.querySelectorAll('.danger-row')]
    expect(danger.length).toBe(2)

    // Collapsed by default: no confirm input on screen until you opt in.
    expect(el.querySelectorAll('.danger-row input').length).toBe(0)

    await act(async () => {
      danger[0].querySelector('button').click()
    })
    const input = el.querySelector('.danger-row input')
    expect(input).toBeTruthy()

    // Confirm stays disabled until the phrase matches exactly.
    const confirm = [...el.querySelectorAll('.danger-open button')].find(
      (b) => b.textContent === 'Confirm'
    )
    expect(confirm.disabled).toBe(true)
  })
})
