# ADR-005: Shared Error and Validation Modules

**Status**: Adopted  
**Date**: 2024-09-09  
**Phases**: L + M (Error Handling + Input Validation)

## Context

API handlers had inconsistent error response shapes, no correlation IDs, and ad-hoc input validation. This made debugging difficult and left injection vectors open.

## Decision

### Error Handling (`api/_lib/errors.js`)
- Consistent shape: `{ success, error, correlationId, code?, meta? }`
- Correlation IDs for cross-log tracking
- Internal errors logged but never exposed to clients
- Common factories: `rateLimited()`, `unauthorized()`, `invalidInput()`, etc.

### Input Validation (`api/_lib/validate.js`)
- Allowlist-based validation (league IDs, purposes, etc.)
- String sanitization with control character rejection (CRLF injection prevention)
- Length limits on all inputs (prevents DoS via oversized payloads)
- Email RFC 5321/5322 compliance

## Consequences

- **Positive**: All errors traceable via correlationId
- **Positive**: No internal detail leakage (cause never in response)
- **Positive**: Injection vectors closed (allowlist, length limits, CRLF rejection)
- **Negative**: Handlers need migration to use new modules
