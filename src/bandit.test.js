import { describe, it, expect } from 'vitest'
import {
  DEFAULT_PRIOR,
  summarize,
  posterior,
  posteriorFromRatings,
  mulberry32,
  randn,
  randGamma,
  sampleMu,
  thompsonPick,
  credibleInterval,
  muStdDev,
  expectedVariance,
} from './bandit.js'

describe('summarize', () => {
  it('accumulates n, sum and sum of squares', () => {
    expect(summarize([5, 4, 5])).toEqual({ n: 3, sum: 14, sumsq: 66 })
  })

  it('is order-independent (the model is stationary)', () => {
    expect(summarize([1, 5, 3])).toEqual(summarize([3, 1, 5]))
  })
})

describe('posterior', () => {
  it('returns the prior unchanged when there is no data', () => {
    const post = posteriorFromRatings(DEFAULT_PRIOR, [])
    expect(post).toEqual({ mu: 3, lambda: 1, alpha: 2, beta: 2, n: 0 })
  })

  it('matches the closed form on a hand-worked example', () => {
    // prior (3, 1, 2, 2) with ratings [5,4,5]:
    //   n=3, sum=14, sumsq=66, rbar=14/3, S=2/3
    //   lambda_n = 1+3 = 4
    //   mu_n     = (3 + 14)/4 = 4.25
    //   alpha_n  = 2 + 3/2 = 3.5
    //   beta_n   = 2 + (2/3)/2 + 1*3*(14/3 - 3)^2 / (2*4) = 2 + 1/3 + 25/24 = 3.375
    const post = posteriorFromRatings(DEFAULT_PRIOR, [5, 4, 5])
    expect(post.lambda).toBeCloseTo(4, 12)
    expect(post.mu).toBeCloseTo(4.25, 12)
    expect(post.alpha).toBeCloseTo(3.5, 12)
    expect(post.beta).toBeCloseTo(3.375, 12)
    expect(post.n).toBe(3)
  })

  it('keeps beta non-negative when every rating is identical', () => {
    // S is exactly 0 here, and floating point can push it slightly negative.
    const post = posteriorFromRatings(DEFAULT_PRIOR, [4, 4, 4, 4, 4, 4, 4])
    expect(post.beta).toBeGreaterThan(0)
    expect(Number.isFinite(post.beta)).toBe(true)
  })

  it('moves the mean toward the data and never past it', () => {
    const post = posteriorFromRatings(DEFAULT_PRIOR, [5, 5, 5, 5])
    expect(post.mu).toBeGreaterThan(DEFAULT_PRIOR.mu)
    expect(post.mu).toBeLessThan(5)
  })

  it('is monotone in the observation', () => {
    const base = [3, 3, 3]
    const up = posteriorFromRatings(DEFAULT_PRIOR, [...base, 5]).mu
    const flat = posteriorFromRatings(DEFAULT_PRIOR, base).mu
    const down = posteriorFromRatings(DEFAULT_PRIOR, [...base, 1]).mu
    expect(up).toBeGreaterThan(flat)
    expect(down).toBeLessThan(flat)
  })

  it('concentrates as data accumulates', () => {
    const few = posteriorFromRatings(DEFAULT_PRIOR, [4, 4, 4])
    const many = posteriorFromRatings(DEFAULT_PRIOR, Array(60).fill(4))
    expect(muStdDev(many)).toBeLessThan(muStdDev(few))
  })

  it('penalises disagreement with the prior by inflating beta', () => {
    // Same spread, but one sample sits far from mu_0 = 3.
    const agree = posteriorFromRatings(DEFAULT_PRIOR, [3, 3, 3, 3])
    const disagree = posteriorFromRatings(DEFAULT_PRIOR, [5, 5, 5, 5])
    expect(disagree.beta).toBeGreaterThan(agree.beta)
  })

  it('separates two arms with equal means but different spread', () => {
    const steady = posteriorFromRatings(DEFAULT_PRIOR, [3, 3, 3, 3, 3, 3, 3, 3])
    const erratic = posteriorFromRatings(DEFAULT_PRIOR, [1, 5, 1, 5, 1, 5, 1, 5])
    expect(steady.mu).toBeCloseTo(erratic.mu, 10)
    expect(expectedVariance(erratic)).toBeGreaterThan(expectedVariance(steady))
  })
})

describe('random number generation', () => {
  it('mulberry32 is deterministic and in [0,1)', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    for (let i = 0; i < 100; i += 1) {
      const x = a()
      expect(x).toBe(b())
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
    }
  })

  it('randn has about the right moments', () => {
    const rng = mulberry32(7)
    const n = 50000
    let sum = 0
    let sumsq = 0
    for (let i = 0; i < n; i += 1) {
      const z = randn(rng)
      sum += z
      sumsq += z * z
    }
    const mean = sum / n
    const variance = sumsq / n - mean * mean
    expect(Math.abs(mean)).toBeLessThan(0.02)
    expect(variance).toBeGreaterThan(0.95)
    expect(variance).toBeLessThan(1.05)
  })

  it('randGamma has mean shape/rate and variance shape/rate^2', () => {
    const rng = mulberry32(99)
    const shape = 3.5
    const rate = 2
    const n = 60000
    let sum = 0
    let sumsq = 0
    for (let i = 0; i < n; i += 1) {
      const g = randGamma(shape, rate, rng)
      expect(g).toBeGreaterThan(0)
      sum += g
      sumsq += g * g
    }
    const mean = sum / n
    const variance = sumsq / n - mean * mean
    expect(mean).toBeCloseTo(shape / rate, 1)
    expect(variance).toBeCloseTo(shape / (rate * rate), 1)
  })

  it('handles shape < 1 via the boost branch without NaN', () => {
    const rng = mulberry32(3)
    for (let i = 0; i < 2000; i += 1) {
      const g = randGamma(0.4, 1.5, rng)
      expect(Number.isFinite(g)).toBe(true)
      expect(g).toBeGreaterThan(0)
    }
  })

  it('rejects degenerate parameters loudly', () => {
    expect(() => randGamma(0, 1)).toThrow(RangeError)
    expect(() => randGamma(1, 0)).toThrow(RangeError)
  })
})

describe('sampleMu', () => {
  it('recovers the posterior mean and variance of mu', () => {
    const post = posteriorFromRatings(DEFAULT_PRIOR, [4, 5, 4, 4, 5, 3, 4])
    const rng = mulberry32(2024)
    const n = 40000
    let sum = 0
    let sumsq = 0
    for (let i = 0; i < n; i += 1) {
      const m = sampleMu(post, rng)
      sum += m
      sumsq += m * m
    }
    const mean = sum / n
    const variance = sumsq / n - mean * mean

    expect(mean).toBeCloseTo(post.mu, 1)
    // Var[mu] = beta / (lambda * (alpha - 1)), the analytic marginal t variance.
    expect(variance).toBeCloseTo(muStdDev(post) ** 2, 1)
  })

  it('can draw outside the 1-5 scale, which is intended', () => {
    // A single 5 on a weak prior leaves real probability above 5. Thompson sampling
    // needs that mass; clamping here would suppress exploration.
    const post = posteriorFromRatings(DEFAULT_PRIOR, [5])
    const rng = mulberry32(11)
    let sawAboveScale = false
    for (let i = 0; i < 5000 && !sawAboveScale; i += 1) {
      if (sampleMu(post, rng) > 5) sawAboveScale = true
    }
    expect(sawAboveScale).toBe(true)
  })
})

describe('thompsonPick', () => {
  it('returns null when there are no arms', () => {
    expect(thompsonPick([])).toBeNull()
    expect(thompsonPick(null)).toBeNull()
  })

  it('always picks the only arm available', () => {
    const arms = [{ id: 'a', posterior: posteriorFromRatings(DEFAULT_PRIOR, [2]) }]
    expect(thompsonPick(arms, mulberry32(1)).id).toBe('a')
  })

  it('favours the better arm but still explores the worse one', () => {
    const arms = [
      { id: 'good', posterior: posteriorFromRatings(DEFAULT_PRIOR, Array(12).fill(5)) },
      { id: 'bad', posterior: posteriorFromRatings(DEFAULT_PRIOR, Array(12).fill(2)) },
    ]
    const rng = mulberry32(5)
    const counts = { good: 0, bad: 0 }
    for (let i = 0; i < 2000; i += 1) counts[thompsonPick(arms, rng).id] += 1

    expect(counts.good).toBeGreaterThan(counts.bad)
    expect(counts.good / 2000).toBeGreaterThan(0.9)
  })

  it('spreads picks roughly evenly across identical arms', () => {
    const post = posteriorFromRatings(DEFAULT_PRIOR, [3, 3, 3])
    const arms = [
      { id: 'x', posterior: post },
      { id: 'y', posterior: post },
    ]
    const rng = mulberry32(8)
    let x = 0
    for (let i = 0; i < 4000; i += 1) if (thompsonPick(arms, rng).id === 'x') x += 1
    expect(x / 4000).toBeGreaterThan(0.45)
    expect(x / 4000).toBeLessThan(0.55)
  })
})

describe('credibleInterval', () => {
  it('brackets the posterior mean and is reproducible', () => {
    const post = posteriorFromRatings(DEFAULT_PRIOR, [4, 4, 5, 3])
    const [lo, hi] = credibleInterval(post)
    expect(lo).toBeLessThan(post.mu)
    expect(hi).toBeGreaterThan(post.mu)
    expect(credibleInterval(post)).toEqual([lo, hi])
  })

  it('narrows as evidence accumulates', () => {
    const [lo1, hi1] = credibleInterval(posteriorFromRatings(DEFAULT_PRIOR, [4, 4]))
    const [lo2, hi2] = credibleInterval(posteriorFromRatings(DEFAULT_PRIOR, Array(50).fill(4)))
    expect(hi2 - lo2).toBeLessThan(hi1 - lo1)
  })

  it('is about +/- 2 marginal sds wide', () => {
    const post = posteriorFromRatings(DEFAULT_PRIOR, Array(40).fill(4))
    const [lo, hi] = credibleInterval(post)
    const width = hi - lo
    const sd = muStdDev(post)
    // Student-t with 2*alpha dof; at this n it is close to normal, so ~3.92 sd.
    expect(width).toBeGreaterThan(3.2 * sd)
    expect(width).toBeLessThan(4.8 * sd)
  })
})

describe('end-to-end recovery', () => {
  // The test that actually catches a swapped parameter or a sign error. Unit tests on
  // the update equations can all pass while the loop still prefers the worst arm.
  it('concentrates pulls on the best arm over a simulated trial', () => {
    const truth = [
      { id: 'bike', mean: 4.5, sd: 0.8 },
      { id: 'bart', mean: 3.0, sd: 0.5 },
      { id: 'drive', mean: 2.0, sd: 1.0 },
    ]
    const rng = mulberry32(20261009)
    const observed = new Map(truth.map((t) => [t.id, []]))
    const pulls = new Map(truth.map((t) => [t.id, 0]))

    const observe = (arm) => {
      const raw = arm.mean + randn(rng) * arm.sd
      return Math.min(5, Math.max(1, Math.round(raw)))
    }

    for (let day = 0; day < 240; day += 1) {
      const arms = truth.map((t) => ({
        id: t.id,
        posterior: posteriorFromRatings(DEFAULT_PRIOR, observed.get(t.id)),
      }))
      const picked = thompsonPick(arms, rng)
      const arm = truth.find((t) => t.id === picked.id)
      observed.get(arm.id).push(observe(arm))
      pulls.set(arm.id, pulls.get(arm.id) + 1)
    }

    // The best arm should dominate, and the worst should be largely abandoned.
    expect(pulls.get('bike')).toBeGreaterThan(140)
    expect(pulls.get('bike')).toBeGreaterThan(pulls.get('bart'))
    expect(pulls.get('bart')).toBeGreaterThan(pulls.get('drive'))

    // And the posterior for the best arm should land near its true mean.
    const best = posteriorFromRatings(DEFAULT_PRIOR, observed.get('bike'))
    expect(best.mu).toBeGreaterThan(4.0)
    expect(best.mu).toBeLessThan(5.0)
  })

  it('still tries every arm at least once early on', () => {
    const truth = [
      { id: 'a', mean: 4.5, sd: 0.8 },
      { id: 'b', mean: 3.0, sd: 0.5 },
      { id: 'c', mean: 2.0, sd: 1.0 },
    ]
    const rng = mulberry32(77)
    const observed = new Map(truth.map((t) => [t.id, []]))

    for (let day = 0; day < 40; day += 1) {
      const arms = truth.map((t) => ({
        id: t.id,
        posterior: posteriorFromRatings(DEFAULT_PRIOR, observed.get(t.id)),
      }))
      const picked = thompsonPick(arms, rng)
      const arm = truth.find((t) => t.id === picked.id)
      const raw = arm.mean + randn(rng) * arm.sd
      observed.get(arm.id).push(Math.min(5, Math.max(1, Math.round(raw))))
    }

    for (const t of truth) {
      expect(observed.get(t.id).length).toBeGreaterThan(0)
    }
  })
})
