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
