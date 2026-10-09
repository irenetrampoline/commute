// Same Supabase project as radish / todo / food / tracker / points.
export const SUPABASE_URL = 'https://wujpugalfrlyjcbzhcxa.supabase.co'
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1anB1Z2FsZnJseWpjYnpoY3hhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIzNzk5MjAsImV4cCI6MjA2Nzk1NTkyMH0.wr2YiMhCPr3q-TPA7HCOgq8cyreaup0FmpGf1dWyTNE'

// Shared PIN for both pages. CHANGE THIS before you start the trial.
//
// Be clear-eyed about what it buys you: this string ships in the public page source,
// and the anon key above lets anyone call the REST API directly regardless. It keeps
// crawlers and anyone who stumbles onto the URL from writing junk into your trial.
// It is not access control. Real protection means RLS policies plus Supabase Auth.
export const PIN = '2026'

export const AUTH_STORAGE_KEY = 'commuteAuth'

/** ?demo renders fixtures and makes no network calls at all. */
export const IS_DEMO = new URLSearchParams(window.location.search).has('demo')
