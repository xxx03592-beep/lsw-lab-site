# Leeframes Studio Website

## 프로젝트 정보
- 순수 HTML/CSS/JS 정적 웹사이트
- Cloudflare Workers(정적 assets)로 배포 (master 브랜치 push 시 Workers Builds가 자동 배포)
- GitHub 저장소: xxx03592-beep/lsw-lab-site (private)
- 도메인: leeframes.com

## 주요 파일
- index.html: 메인 페이지
- lookbook.html: Lookbook 페이지 (meta.js / meta.css 사용)
- meta-ad-creatives.html: Meta Ad Creatives 페이지 (lookbook.js / lookbook.css 사용)
- quote.html / quote.css / quote.js: Get a quote 견적 문의 페이지
- worker.js: Cloudflare Worker. 정적 파일은 그대로 서빙하고 /api/quote(견적 폼)만 처리해 메일 발송(send_email 바인딩 EMAIL). Workers 무료 플랜이라 Email Routing에서 인증된 받는 주소로만 보낼 수 있어서, 받는 주소는 Cloudflare 대시보드의 QUOTE_TO 시크릿(Workers → lsw-lab-site → Settings)으로 지정함. 문의자에게 자동 회신도 보내지만, 무료 플랜에선 인증된 주소에만 도착(나머지는 조용히 실패, 요청 자체는 정상 처리)
- wrangler.jsonc: Workers 배포 설정 (Workers Builds가 master push 시 사용)
- .assetsignore: 공개하면 안 되는 파일 목록 (새 내부 파일을 추가하면 여기에도 추가)
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
- push하면 Workers Builds가 자동으로 재배포함. GitHub 체크가 "Preview creation failed"로 실패 표시돼도 실제 배포는 성공했을 수 있으니 대시보드 Deployments 또는 실제 사이트로 확인
