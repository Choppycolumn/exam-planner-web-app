# PostgreSQL Migration Placeholder

The production app intentionally remains on SQLite for the current personal deployment.

This folder documents the future migration boundary:

- keep frontend API contracts unchanged;
- introduce `server/db/repositories/*` first;
- add dual-write only after SQLite repository tests pass;
- migrate read paths one domain at a time;
- keep SQLite backups until PostgreSQL restore drills pass.

Do not enable PostgreSQL in production until this checklist is complete.
