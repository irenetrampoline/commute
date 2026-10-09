// The two pages live at different paths in dev and in production, so cross-links have
// to know which they're in.
//
// Built: Hugo mirrors static/ verbatim, giving /commute/ and /commute-edit/.
// Dev:   one Vite server with two entries, at / and /edit.html.
//
// This matters more than it looks. Vite's dev server falls back to index.html for any
// unknown path, so a hardcoded /commute-edit/ link in dev doesn't 404 - it silently
// re-serves the main page at that URL, which looks exactly like a dead link.

export const MAIN_HREF = import.meta.env.DEV ? '/' : '/commute/'
export const EDIT_HREF = import.meta.env.DEV ? '/edit.html' : '/commute-edit/'
