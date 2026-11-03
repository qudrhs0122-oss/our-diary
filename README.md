# 우리 다이어리

둘이 함께 쓰는 안드로이드 앱 — 공유 캘린더 · 대화식 노트 · 사진 기록.

- `www/` 앱 화면과 기능 (HTML/CSS/JS)
- `supabase/setup.sql` Supabase SQL Editor에서 한 번 실행
- `main` 브랜치에 올리면 GitHub Actions가 APK를 만들어 `apk` 브랜치에 `our-diary.apk`로 올림

## 아이폰에서 쓰기
- `main`에 올리면 GitHub Actions(`deploy-web.yml`)가 `www/`를 GitHub Pages에 올림
- 주소: https://qudrhs0122-oss.github.io/our-diary/
- 아이폰 사파리에서 주소 열기 → 공유 버튼 → **홈 화면에 추가** → 손전등 아이콘으로 앱처럼 열림
