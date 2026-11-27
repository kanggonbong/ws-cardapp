# 우성고 카드 시스템

우성고등학교 법인카드 대여·반납 화면 (GitHub Pages).

- 앱: https://kanggonbong.github.io/ws-cardapp/
- 휴대폰 설치 안내(QR용): https://kanggonbong.github.io/ws-cardapp/gate.html

| 파일 | 역할 |
|---|---|
| `index.html` | 앱 화면 (빌드 결과물, 직접 고치지 않음) |
| `gate.html` | 휴대폰 홈 화면 설치 안내 (안드로이드 · 아이폰 · 카카오톡 등 자동 구분) |
| `manifest.json` | 설치했을 때 이름 · 아이콘 · 색 |
| `sw.js` | 서비스 워커 (항상 최신 화면, 오프라인일 때만 저장본) |
| `assets/` | 아이콘 |
