# Redis Optional Cache/Queue Placeholder

Redis is not required for the current single-user deployment.

Valid future uses:

- task queue if background jobs become long-running or concurrent;
- short-lived API result cache;
- distributed lock if the service runs more than one Node process.

Do not add Redis to production while the app runs as one systemd service and SQLite remains sufficient.
