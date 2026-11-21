# Leeframes Studio Website

## 프로젝트 정보
- 순수 HTML/CSS/JS 정적 웹사이트
- Cloudflare Pages로 배포 (main 브랜치 push 시 자동 배포)
- GitHub 저장소: xxx03592-beep/lsw-lab-site (private)
- 도메인: leeframes.com

## 주요 파일
- index.html: 메인 페이지
- lookbook.html: Lookbook 페이지 (meta.js / meta.css 사용)
- meta-ad-creatives.html: Meta Ad Creatives 페이지 (lookbook.js / lookbook.css 사용)
- quote.html / quote.css / quote.js: Get a quote 견적 문의 페이지 (제출 시 hello@leeframes.com 메일 작성)
- styles.css: 메인 스타일
- lookbook.css: lookbook/meta 공통 스타일
- meta.css: meta-ad-creatives 전용 스타일
- script.js: 메인 페이지 스크립트
- lookbook.js: lookbook 페이지 스크립트
- meta.js: meta-ad-creatives 스크립트
- site-data.js: 프로젝트/광고 데이터
- serve.ps1: 로컬 미리보기 서버 (port 5173)

## 작업 규칙
- 코드 수정 후 반드시 git add, commit, push까지 완료할 것
- 커밋 메시지는 변경 내용을 간결하게 한국어 또는 영어로 작성
- push하면 Cloudflare Pages가 자동으로 재배포함
