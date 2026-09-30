# AGENTS.md

## Deployment Safety

- Treat local file changes as the default stopping point for all work in this repository.
- Do not run `git commit`, `git push`, deployment commands, or any other command that publishes changes to the live site unless the user explicitly asks to "커밋해", "푸시해", or "배포해".
- For ordinary modification requests, edit the files locally, verify the changes when practical, and report the changed files and how to check them.
- Do not use live-site checks such as `curl https://jeongwa.com ...` during normal local work. Use them only when the user explicitly requests deployment verification.
- If a task appears to require a live change, pause before publishing and ask the user for confirmation.

## Patch Notes

- 사용자에게 보이는 변경(기능 추가, 화면 개선, 버그 수정, 공지)은 `patch-notes.json`에 기록한다. 헤더의 패치노트 버튼이 이 파일을 읽어 보여준다.
- 패치노트 항목은 시청자가 이해할 수 있는 말로 쓴다. 내부 리팩터링이나 코드 정리는 적지 않는다.
- 항목 추가는 `node scripts/add-patch-note.js --tag 개선 --item "변경 내용"` 으로 한다. 태그 예: 추가, 개선, 수정, 공지. 같은 날짜·태그면 항목이 합쳐진다.
- 사용자가 커밋·푸시·배포를 명시적으로 요청했을 때만, 그 전에 `node scripts/check-patch-note.js` 를 실행해 오늘 날짜 항목이 있는지 확인한다. `.githooks/pre-push` 가 main 푸시 때 같은 검사를 한다. 실패하면 위 명령으로 항목을 추가하고 다시 확인한다.
- 곡 데이터(`songs-data.js`)만 바뀌는 자동·수동 갱신은 패치노트 없이 배포해도 된다.
- 훅을 쓰려면 저장소를 새로 clone한 뒤 한 번 `git config core.hooksPath .githooks` 를 실행한다.
- 이 머신에는 `node` 가 없어 Codex 번들 런타임(`~/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`)을 대신 쓴다.
