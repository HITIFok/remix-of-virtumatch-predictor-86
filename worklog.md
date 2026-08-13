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
