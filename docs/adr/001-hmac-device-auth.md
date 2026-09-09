# ADR-001: HMAC-SHA256 Device Token Authentication

**Status**: Adopted  
**Date**: 2024-09-09  
**Phase**: A (V-01, CVSS 9.1)

## Context

The original authentication scheme accepted plain `x-device-id` headers without any integrity verification. An attacker could forge device tokens to impersonate any user, access their predictions, and bypass rate limits.

## Decision

Implement HMAC-SHA256 signed device tokens with a migration period:

1. **Primary**: `x-hmac-token` header containing `HMAC-SHA256(deviceId, secret)` + `.` + `deviceId`
2. **Fallback**: Plain `x-device-id` accepted only for GET requests during migration (`HMAC_ONLY=false`)
3. **Future**: Set `HMAC_ONLY=true` to reject all plain tokens

## Consequences

- **Positive**: Cryptographic verification prevents token forgery (CVSS 9.1 → 0)
- **Positive**: Migration period allows gradual client upgrades
- **Negative**: Requires client-side HMAC implementation
- **Negative**: Migration period temporarily allows limited fallback

## Security Properties

- Timing-safe comparison (prevents timing attacks)
- HMAC secret from env var (never hardcoded)
- Fallback restricted to GET (no state mutation)
- All auth attempts logged with redacted tokens
