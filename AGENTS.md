# AGENTS.md

## Deployment Safety

- Treat local file changes as the default stopping point for all work in this repository.
- Do not run `git commit`, `git push`, deployment commands, or any other command that publishes changes to the live site unless the user explicitly asks to "커밋해", "푸시해", or "배포해".
- 일반 수정 요청은 로컬 파일 수정에서 멈추고, 아래 작업 방식에 따라 검증하고 보고한다.
- Do not use live-site checks such as `curl https://jeongwa.com ...` during normal local work. Use them only when the user explicitly requests deployment verification.
- If a task appears to require a live change, pause before publishing and ask the user for confirmation.

## Patch Notes

- 사용자에게 보이는 변경(기능 추가, 화면 개선, 버그 수정, 공지)은 `patch-notes.json`에 기록한다. 헤더의 패치노트 버튼이 이 파일을 읽어 보여준다.
- 패치노트 항목은 시청자가 이해할 수 있는 말로 쓴다. 내부 리팩터링이나 코드 정리는 적지 않는다.
- 항목 추가는 `node scripts/add-patch-note.js --tag 개선 --item "변경 내용"` 으로 한다. 태그 예: 추가, 개선, 수정, 공지. 같은 날짜·태그면 항목이 합쳐진다.
- 사용자가 커밋·푸시·배포를 명시적으로 요청했을 때만, 그 전에 `node scripts/check-patch-note.js` 를 실행해 오늘 날짜 항목이 있는지 확인한다. `.githooks/pre-push` 가 main 푸시 때 같은 검사를 한다. 실패하면 위 명령으로 항목을 추가하고 다시 확인한다.
- 곡 데이터(`songs-data.js`)만 바뀌는 자동·수동 갱신은 패치노트 없이 배포해도 된다.
- 훅을 쓰려면 저장소를 새로 clone한 뒤 한 번 `git config core.hooksPath .githooks` 를 실행한다.
- 패치노트 명령 실행 전 사용 가능한 Node를 확인한다. Node가 없거나 훅이 검사를 건너뛰면 확인 불가로 보고하고, 검사가 통과하기 전에는 푸시·배포하지 않는다.

## 작업 방식

- 문제·이상 현상은 수정 전에 재현·측정하고, 원인과 관련 수치·측정 방법을 먼저 보고한다. 원인이 확정되지 않았으면 추측(근거 없음) 또는 확인 불가로 표시한다. 수치가 모순되면 측정 조건을 확인하고 다시 측정한다.
- 화면 수정은 로컬 브라우저에서 320px, 375px, 데스크톱 폭으로 확인한다. 실제 확인한 폭과 가로 스크롤·요소 겹침·콘솔 오류 여부를 보고한다. 확인하지 못한 항목은 확인 불가로 적고 검증 완료라고 말하지 않는다.
- 여러 파일 변경, Supabase 권한·RLS·SQL, 로그인, 데이터 변경이 필요한 작업은 수정 전에 범위·위험·검증 방법을 계획으로 보여주고 확인받는다. 이미 승인된 범위는 재승인받지 않으며, 범위가 커지면 다시 확인받는다. SQL 실행·DB 변경은 실행 내용에 대한 명시적 승인 없이 하지 않는다.
- 결과는 변경 파일 → 검증 방법과 결과 → 확인하지 못한 항목 순으로, 비전문가가 이해할 수 있는 말로 보고한다.

## 환경 확인

- 새 기기에서 커밋·푸시를 요청받으면 Git 사용자 정보, 원격 인증, Node, core.hooksPath를 먼저 확인하고 부족한 설정을 보고한다. 설정 변경은 승인받은 뒤 수행한다.
