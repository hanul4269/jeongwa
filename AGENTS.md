# AGENTS.md

## Deployment Safety

- Treat local file changes as the default stopping point for all work in this repository.
- Do not run `git commit`, `git push`, deployment commands, or any other command that publishes changes to the live site unless the user explicitly asks to "커밋해", "푸시해", or "배포해".
- For ordinary modification requests, edit the files locally, verify the changes when practical, and report the changed files and how to check them.
- Do not use live-site checks such as `curl https://jeongwa.com ...` during normal local work. Use them only when the user explicitly requests deployment verification.
- If a task appears to require a live change, pause before publishing and ask the user for confirmation.
