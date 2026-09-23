# FIX — Vercel SPA Rewrite / Dynamic Import History

**Date**: 2026-09-23
**Commit**: `997a9d1`
**Status**: DEPLOYED — awaiting browser verification

---

## Root Cause

The `vercel.json` SPA rewrite rule `/((?!api/.*).*)` catches ALL paths except `/api/`, including `/assets/History-*.js`. When the browser dynamically imports the History chunk via `lazy(() => import("./pages/History"))`, the request is rewritten to `/index.html`, which returns `Content-Type: text/html`. The browser rejects this as a JavaScript module:

```
Failed to load module script:
Expected a JavaScript-or-Wasm module script
but the server responded with a MIME type of "text/html".
```

## Old Vercel Rule

```json
"rewrites": [
  {
    "source": "/((?!api/.*).*)",
    "destination": "/index.html"
  }
]
```

Only excludes `/api/` — `/assets/` is caught by the SPA rewrite.

## New Vercel Rule

```json
"rewrites": [
  {
    "source": "/((?!api/.*|assets/.*).*)",
    "destination": "/index.html"
  }
]
```

Excludes both `/api/` and `/assets/` from the SPA rewrite. Static files in `/assets/` are now served directly by Vercel with the correct MIME type.

## Build Result

```
✓ built in 1.72s
dist/assets/History-xxi3K4iS.js    28.23 kB │ gzip: 6.87 kB
```

## Generated History Chunk

- **Filename**: `History-xxi3K4iS.js`
- **Size**: 28.23 kB (6.87 kB gzip)
- **Path**: `/assets/History-xxi3K4iS.js`

## Expected HTTP Results After Fix

### `/assets/History-xxi3K4iS.js`
- **Status**: 200
- **Content-Type**: `application/javascript`
- **Body**: JavaScript chunk content

### SPA routes (`/`, `/history`, `/live`, `/shop`, `/guide`, `/settings`)
- **Status**: 200
- **Content-Type**: `text/html`
- **Body**: `index.html` (SPA shell)

### API routes (`/api/*`)
- **Status**: varies (200, 201, 401, etc.)
- **Not rewritten** — handled by serverless functions

### Other assets (`/assets/*`)
- **Status**: 200
- **Content-Type**: appropriate MIME (`application/javascript`, `text/css`, etc.)
- **Not rewritten** — served as static files

## Service Worker / PWA

The project uses `vite-plugin-pwa` with `registerType: autoUpdate`, `skipWaiting: true`, `clientsClaim: true`. After deployment:

1. The new Service Worker will be installed on next visit
2. Old cached chunk references will be updated via `autoUpdate`
3. If a stale SW serves an old chunk reference, a hard refresh (Ctrl+Shift+R) will force update

## Verification Checklist

- [ ] Open `/` — app loads correctly
- [ ] Open DevTools → Network
- [ ] Click "Historique" tab
- [ ] Verify `/assets/History-*.js` request: Status 200, Content-Type JavaScript
- [ ] No `Failed to fetch dynamically imported module` error
- [ ] No MIME `text/html` for JS chunks
- [ ] Test direct URL: `https://virtual-match-hitifproject.vercel.app/assets/History-xxi3K4iS.js` → 200, `application/javascript`
- [ ] Test SPA routes: `/history`, `/live`, `/shop` → 200, `text/html`
- [ ] Test API: `/api/predictions` → not rewritten to index.html
- [ ] Test after SW update: close browser, reopen, navigate to History — no errors

## Commit

- **Hash**: `997a9d1`
- **Message**: `fix: exclude /assets/ from SPA rewrite to fix History dynamic import MIME error`
- **Deployment**: `https://virtual-match-hitifproject.vercel.app/`

## Scope

This fix touches ONLY the Vercel routing configuration. No coefficients, weights, prediction algorithms, AI prompts, scientific pipeline, or database schema were modified.
