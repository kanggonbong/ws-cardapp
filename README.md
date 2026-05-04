# 우성고 카드 시스템

이 저장소는 아래 3개 영역으로 나눠서 관리하는 것을 기준으로 정리했습니다.

## 폴더 구조

- `frontend/`
  GitHub Pages에 올릴 프론트엔드 파일
- `apps-script/`
  Google Apps Script에 붙여넣을 백엔드 파일
- `worker/`
  Cloudflare Worker 프록시 파일

## 현재 포함된 파일

- `frontend/index.html`
  GitHub Pages용 프론트엔드 시작 파일
- `apps-script/Code.gs`
  수정된 Apps Script 서버 코드
- `apps-script/appsscript.json`
  Apps Script 매니페스트
- `worker/worker.js`
  Apps Script와 프론트 사이를 연결할 Cloudflare Worker 기본 템플릿

## 추천 진행 순서

1. 이 폴더 전체를 GitHub 저장소로 올립니다.
2. `frontend/` 기준으로 GitHub Pages를 켭니다.
3. Cloudflare Worker를 만들고 `worker/worker.js`를 배포합니다.
4. Apps Script에 `apps-script/Code.gs`와 `apps-script/appsscript.json`을 반영합니다.
5. 마지막으로 `frontend/index.html`을 실제 카드 시스템 UI로 교체하고 Worker 주소를 연결합니다.

## 메모

- 현재 루트의 `Code.gs`, `appsscript.json`은 작업본으로 남겨두었습니다.
- 배포 기준 파일은 `apps-script/` 폴더 안에 있는 복사본을 사용하면 됩니다.
