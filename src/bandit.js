// Thompson sampling over commute options with a Normal-Inverse-Gamma posterior.
//
// Each option is an arm whose daily 1-5 rating is modelled as r ~ Normal(mu, sigma^2)
// with both mu and sigma^2 unknown. The NIG prior is conjugate, so the posterior has a
// closed form and we never need to store anything but the raw ratings.
//
// Learning sigma^2 per arm is the point of choosing NIG over a Beta/Bernoulli reduction:
// a bike commute that swings between 5 and 1 with the weather is genuinely different from
// a train that is reliably 3, even when their means match, and the sampler should know it.
//
// Everything here is pure: no DOM, no network, no module-level mutable state. The RNG is
// always injectable so tests and the credible-interval display are reproducible.

/** Neutral starting point: "a 3 out of 5, weakly held". */
export const DEFAULT_PRIOR = Object.freeze({
  mu: 3, // mu_0     - prior mean rating
  lambda: 1, // lambda_0 - prior strength, in pseudo-observations
  alpha: 2, // alpha_0  - shape; must stay > 1 for E[sigma^2] to exist
  beta: 2, // beta_0   - scale; E[sigma^2] = beta/(alpha-1) = 2, so sd ~ 1.4
})

// ---------------------------------------------------------------------------
// Posterior
// ---------------------------------------------------------------------------

/** Sufficient statistics. Ratings order is irrelevant, which is why this is stationary. */
export function summarize(ratings) {
  let n = 0
  let sum = 0
  let sumsq = 0
  for (const r of ratings) {
    n += 1
    sum += r
    sumsq += r * r
  }
  return { n, sum, sumsq }
}

/**
 * Standard NIG update. With rbar the sample mean and S the centred sum of squares:
 *
 *   lambda_n = lambda_0 + n
 *   mu_n     = (lambda_0*mu_0 + sum) / lambda_n
 *   alpha_n  = alpha_0 + n/2
 *   beta_n   = beta_0 + S/2 + lambda_0*n*(rbar - mu_0)^2 / (2*lambda_n)
 *
 * The last term is the penalty for the prior mean disagreeing with the data: surprise
 * inflates the variance estimate, which is what keeps a single outlier day from making
 * an arm look falsely precise.
 */
export function posterior(prior, stats) {
  const { mu: mu0, lambda: lambda0, alpha: alpha0, beta: beta0 } = prior
  const { n, sum, sumsq } = stats

  if (n === 0) {
    return { mu: mu0, lambda: lambda0, alpha: alpha0, beta: beta0, n: 0 }
  }

  const rbar = sum / n
  // Clamp at 0: algebraically sumsq - n*rbar^2 >= 0, but floating point can dip
  // a hair below when every rating is identical, and a negative beta is poison.
  const S = Math.max(0, sumsq - n * rbar * rbar)

  const lambdaN = lambda0 + n
  const muN = (lambda0 * mu0 + sum) / lambdaN
  const alphaN = alpha0 + n / 2
  const betaN = beta0 + S / 2 + (lambda0 * n * (rbar - mu0) ** 2) / (2 * lambdaN)

  return { mu: muN, lambda: lambdaN, alpha: alphaN, beta: betaN, n }
}

/** Convenience: prior + raw ratings -> posterior. */
export function posteriorFromRatings(prior, ratings) {
  return posterior(prior, summarize(ratings))
}

// ---------------------------------------------------------------------------
// Random number generation
// ---------------------------------------------------------------------------

/** Seeded PRNG, so a displayed credible interval doesn't jitter on every re-render. */
export function mulberry32(seed) {
  let a = seed >>> 0
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Standard normal via Box-Muller. */
export function randn(rng = Math.random) {
  let u = 0
  let v = 0
  while (u === 0) u = rng()
  while (v === 0) v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/**
 * Gamma(shape, rate) via Marsaglia-Tsang (2000).
 *
 * That method requires shape >= 1; the shape < 1 case uses the standard boost
 * Gamma(a) == Gamma(a+1) * U^(1/a). With the default prior alpha_0 = 2 we are always
 * comfortably above 1, but priors are editable in the admin page and a hand-typed
 * alpha_0 of 0.5 should not silently produce NaN.
 */
export function randGamma(shape, rate = 1, rng = Math.random) {
  if (!(shape > 0) || !(rate > 0)) {
    throw new RangeError(`randGamma needs shape>0 and rate>0, got ${shape}, ${rate}`)
  }

  if (shape < 1) {
    let u = rng()
    while (u === 0) u = rng()
    return randGamma(shape + 1, rate, rng) * Math.pow(u, 1 / shape)
  }

  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)

  for (;;) {
    let x
    let v
    do {
      x = randn(rng)
      v = 1 + c * x
    } while (v <= 0)

    v = v * v * v
    const u = rng()
    const x2 = x * x

    // Cheap squeeze first, full acceptance test only if it fails.
    if (u < 1 - 0.0331 * x2 * x2) return (d * v) / rate
    if (Math.log(u) < 0.5 * x2 + d * (1 - v + Math.log(v))) return (d * v) / rate
  }
}

/** One joint draw of (mu, sigma^2) from the posterior. */
export function sampleParams(post, rng = Math.random) {
  // sigma^2 ~ InverseGamma(alpha, beta) == 1 / Gamma(alpha, rate = beta)
  const sigma2 = 1 / randGamma(post.alpha, post.beta, rng)
  // mu | sigma^2 ~ Normal(mu_n, sigma^2 / lambda_n)
  const mu = post.mu + randn(rng) * Math.sqrt(sigma2 / post.lambda)
  return { mu, sigma2 }
}

/** One draw of mu from the posterior - the quantity Thompson sampling ranks on. */
export function sampleMu(post, rng = Math.random) {
  return sampleParams(post, rng).mu
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * Draw one mu per arm and return the argmax. This *is* Thompson sampling: an arm is
 * played in proportion to the posterior probability that it is the best one.
 *
 * The draws are deliberately not clamped to [1,5]. A draw of 5.8 means "this arm could
 * plausibly be better than anything I've seen", which is exactly the uncertainty that
 * should earn it another day. Clamping would pile probability mass on the boundary and
 * flatten the distinction between a promising arm and a proven one. Clamp for display
 * only - see formatMean below.
 *
 * @param {Array<{id: *, posterior: object}>} arms
 * @returns {{id: *, draw: number, draws: Map}|null} null when there are no arms
 */
export function thompsonPick(arms, rng = Math.random) {
  if (!arms || arms.length === 0) return null

  const draws = new Map()
  let bestId = null
  let best = -Infinity

  for (const arm of arms) {
    const draw = sampleMu(arm.posterior, rng)
    draws.set(arm.id, draw)
    if (draw > best) {
      best = draw
      bestId = arm.id
    }
  }

  return { id: bestId, draw: best, draws }
}

// ---------------------------------------------------------------------------
// Summaries for display
// ---------------------------------------------------------------------------

/**
 * Equal-tailed 95% credible interval for mu, by Monte Carlo over the posterior.
 *
 * The analytic answer is a Student-t with 2*alpha dof, location mu, scale
 * sqrt(beta/(alpha*lambda)) - but a correct t quantile needs an inverse incomplete beta,
 * and sampling reuses code that is already under test. Seeded, so the interval is stable
 * across renders rather than twitching every time React repaints.
 */
export function credibleInterval(post, { draws = 4000, seed = 12345, level = 0.95 } = {}) {
  const xs = new Float64Array(draws)
  const rng = mulberry32(seed)
  for (let i = 0; i < draws; i += 1) xs[i] = sampleMu(post, rng)
  xs.sort()

  const tail = (1 - level) / 2
  const lo = xs[Math.floor(tail * draws)]
  const hi = xs[Math.min(draws - 1, Math.floor((1 - tail) * draws))]
  return [lo, hi]
}

/** Analytic sd of the marginal posterior for mu. Exists only when alpha > 1. */
export function muStdDev(post) {
  if (post.alpha <= 1) return Infinity
  // Var[mu] = beta / (lambda * (alpha - 1))
  return Math.sqrt(post.beta / (post.lambda * (post.alpha - 1)))
}

/** Posterior mean of sigma^2, i.e. how erratic this option is. Needs alpha > 1. */
export function expectedVariance(post) {
  if (post.alpha <= 1) return Infinity
  return post.beta / (post.alpha - 1)
}

/** Clamp to the rating scale for display. Never use this before an argmax. */
export function clampToScale(x) {
  return Math.min(5, Math.max(1, x))
}
