# ADR-003: Content Security Policy via vercel.json

**Status**: Adopted  
**Date**: 2024-09-09  
**Phase**: C (V-03, CVSS 8.4)

## Context

The original CSP included `unsafe-inline` and `unsafe-eval`, negating XSS protection. The application uses inline styles (Tailwind) and Google Fonts.

## Decision

Implement strict CSP via `vercel.json` headers with nonce-free approach:

1. **style-src**: `self` + `unsafe-inline` (Tailwind CSS requirement, documented risk)
2. **script-src**: `self` only (no `unsafe-eval`, no `unsafe-inline` for JS)
3. **font-src**: `self` + `fonts.googleapis.com` + `fonts.gstatic.com`
4. **img-src**: `self` + `data:` + `https:` (inline avatars + external images)
5. **connect-src**: `self` + API origin (no arbitrary external requests)
6. **frame-src**: `none` (no iframes)
7. **object-src**: `none` (no Flash/Java)

## Consequences

- **Positive**: JS injection blocked (no `unsafe-inline` for scripts)
- **Positive**: No `unsafe-eval` (prevents `eval()` attacks)
- **Negative**: `unsafe-inline` for styles required by Tailwind CSS
- **Mitigated**: Style-only XSS is low severity (no JS execution)

## Security Properties

- `object-src 'none'` + `base-uri 'self'` + `form-action 'self'`
- No `unsafe-eval` anywhere
- `unsafe-inline` only for `style-src` (documented, accepted risk)
