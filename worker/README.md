# Cloudflare Worker — Google Vision OCR Proxy

GitHub Pages는 정적 호스팅이라 API 키를 보관할 수 없어서, 이 Worker가 키 보관·요청 중계 역할을 합니다.

## 1. Google Cloud Vision API 키 발급
1. https://console.cloud.google.com 접속 (구글 계정으로)
2. 새 프로젝트 생성 (예: `receipt-ocr`)
3. 좌측 메뉴 → "API 및 서비스" → "라이브러리"
4. "Cloud Vision API" 검색 → 사용 설정
5. "사용자 인증 정보" → "사용자 인증 정보 만들기" → "API 키"
6. 발급된 키 복사 (예: `AIzaSy...`)
7. (선택) 키 제한 — "API 제한사항" → "Cloud Vision API"만 허용

**무료 한도**: 월 1,000 요청 영구 무료. 초과 시 1,000건당 $1.50.

## 2. Cloudflare 계정 + Worker 배포
```bash
# 첫 1회만
npm install -g wrangler
wrangler login   # 브라우저로 Cloudflare 로그인

# 이 디렉터리에서:
cd worker
wrangler secret put GOOGLE_VISION_API_KEY
# → 위에서 복사한 키 붙여넣기 + Enter

wrangler deploy
# → 배포 후 URL 출력됨, 예:
# https://expense-receipt-vision.<account>.workers.dev
```

## 3. 발급된 Worker URL을 사이트에 등록
1. https://zoids901-debug.github.io/expense-receipt-pdf/ 접속
2. 우상단 ⚙️ "API 설정" 클릭
3. Worker URL 붙여넣기 → 저장
4. localStorage에 저장됨 (다른 사람도 같은 사이트에서 같은 URL 입력하면 사용 가능)

## 4. 비용·할당량 모니터링
- Google Vision: https://console.cloud.google.com/apis/dashboard
- Cloudflare Worker: https://dash.cloudflare.com → Workers & Pages → Analytics

## 6. 학습 로그 수집 (실패/정답 모으기)

자동매칭 **실패/의심** 사례와, 사용자가 **손으로 고친 정답**을 한곳에 모아 매칭 규칙을 개선하는 용도. 비용 0 (KV 무료 한도).

### 설정 (1회)
```bash
cd worker
wrangler kv namespace create LOGS
# → 출력된 id 를 wrangler.toml 의 [[kv_namespaces]] binding="LOGS" id="..." 에 붙여넣기

wrangler secret put LOG_TOKEN
# → 아무 긴 비밀문자열 입력 (덤프 볼 때 쓰는 열쇠)

wrangler deploy
```

### 모인 로그 보기
브라우저에서:
```
https://expense-receipt-vision.<account>.workers.dev/?dump=<LOG_TOKEN>
```
JSON으로 전체 이벤트가 나옴. `type: "automatch"`(실패/의심) 와 `type: "correction"`(수동 정답)을 보고 규칙을 개선.
보관 기간 180일 자동 만료.

## 5. 도메인 제한 (보안)
`wrangler.toml`의 `ALLOWED_ORIGINS`에 허용 도메인을 콤마 구분으로:
```toml
[vars]
ALLOWED_ORIGINS = "https://zoids901-debug.github.io,http://localhost:8765"
```
재배포: `wrangler deploy`
