# ADR-002: Origin-Based CORS with Allowlist

**Status**: Adopted  
**Date**: 2024-09-09  
**Phase**: A (V-02, CVSS 8.6)

## Context

The original CORS configuration used `Access-Control-Allow-Origin: *`, allowing any origin to make authenticated requests to the API. This enabled CSRF attacks and credential theft.

## Decision

Implement origin-based CORS with a hardcoded allowlist:

1. **Allowlist**: `virtual-match-hitifproject.vercel.app`, `localhost:5173` (dev)
2. **Dynamic**: `*.vercel.app` subdomain pattern for preview deployments
3. **Credentials**: `Access-Control-Allow-Credentials: true` only for allowed origins
4. **Vary**: `Origin` header to prevent CDN caching attacks

## Consequences

- **Positive**: Only known origins can make authenticated cross-origin requests
- **Positive**: Preview deployments on Vercel subdomains work automatically
- **Negative**: New production domains must be added to allowlist
- **Negative**: Slightly more complex than wildcard CORS

## Security Properties

- No wildcard `*` for Allow-Origin
- `Vary: Origin` prevents caching confusion
- Credentials header only for allowed origins
- Preflight caching limited to 1 hour
