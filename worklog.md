---
Task ID: 3
Agent: main
Task: Fix analyze-match 500 error (Vercel timeout on "Prédire tous les matchs")

Work Log:
- Diagnosed: "A server e..." = Vercel HTML error page, not JSON → function killed by 10s Hobby timeout
- Root cause: Groq API call (4.5s) + cold start (1-3s) + auth DB call (0-2s) > 10s budget
- Server fix (api/analyze-match.js):
  - Wrapped entire handler in global timeout guard (8s) → always returns JSON (504), never Vercel HTML
  - Auth moved inside try/catch (was outside — unhandled auth errors returned HTML)
  - Reduced DEADLINE_MS from 4500 to 2500 (leaves buffer for cold start + auth)
  - Dynamic deadline: effectiveDeadline = min(2500, remainingMs - 1000)
  - Aggressive batch routing: >3 matches → instant math fallback (no Groq call at all)
  - Lowered token threshold from 8000 to 5000 for 2-3 match batches
- Client fix (LiveMatches.tsx + Index.tsx):
  - Added content-type check before res.json() — handles Vercel HTML gracefully
  - Falls back to math predictions silently when AI is unavailable
- TypeScript compiles clean

Stage Summary:
- analyze-match v25: timeout-resilient, always returns JSON
- 1 match: Groq AI (up to 2.5s) with math fallback
- 2-3 matches: Groq if tokens < 5000, else math
- 4+ matches: instant math (no Groq, no timeout risk)
- Global 8s guard returns JSON 504 instead of Vercel HTML 500
- Client-side content-type check prevents JSON parse crash

---
Task ID: 1
Agent: main
Task: Fix cron-job.org timeout on auto-playout endpoint

Work Log:
- Diagnosed issue: auto-playout v2 took too long (9 API discovery calls + playout fetches + DB writes) → exceeded cron-job.org ~30s timeout
- Refactored to v3 (fire-and-forget): handler responds 202 Accepted immediately in <1s
- All heavy work moved to runPlayout() background function
- Uses res.unstable_waitUntil() to keep Vercel function alive after response
- Syntax checked with node -c
- Pushed to GitHub: bc6b445

Stage Summary:
- auto-playout v3: responds 202 instantly, processes in background
- No changes needed in frontend (202 is res.ok)
- cron-job.org will now get a response within 1-2 seconds instead of timing out

---
Task ID: 2
Agent: main
Task: Add searchable device ID dropdown in Admin Migration section

Work Log:
- Created `src/hooks/use-admin-device-ids.ts` — hook that fetches device list from `GET /api/admin-codes?action=migrate`, caches result, returns deviceInfos + activations
- Created `src/components/DeviceIdSearch.tsx` — searchable combobox for device IDs with: search filter, highlight matching text, stats per device (predictions count, correct/pending, premium status + expiry), "Sélectionné" badge, free-text fallback, excludeDeviceId to avoid showing source in destination picker
- Updated `src/pages/Admin.tsx` — replaced plain `<input>` for fromDevice/toDevice with `<DeviceIdSearch>`, added "Rafraîchir la liste des devices" button, refetch after session verification

Stage Summary:
- 3 files created/modified: `use-admin-device-ids.ts` (new), `DeviceIdSearch.tsx` (new), `Admin.tsx` (updated)
- TypeScript compiles with no errors
- Each device in the dropdown shows: device_id, total predictions, correct count, pending count, premium status + expiry date
- The "from" picker excludes the selected "to" device and vice versa (prevents same-device selection)
- Free-text input is still supported via "Utiliser tel quel" fallback option
