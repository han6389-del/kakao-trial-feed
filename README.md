# kakao-trial-feed

카카오 선물하기 **체험단(트라이얼 캠페인)** 모집 목록을 폰에서 바로 훑고, 신청 여부를 체크해 두는 모바일 피드.
매일 오전 10:05(KST) GitHub Actions 가 목록을 새로 받아 `data/campaigns.json` 을 갱신한다.

- 저장소: https://github.com/han6389-del/kakao-trial-feed
- 배포: https://han6389-del.github.io/kakao-trial-feed/
- 이 저장소는 **웹 피드 전용**이다. 빌드 도구 없이 정적 파일 그대로 GitHub Pages 에서 돈다.

## 구성

| 경로 | 내용 |
| --- | --- |
| `index.html` | 모바일 퍼스트 단일 페이지 앱 (마크업) |
| `styles.css`, `app.js` | 화면 스타일과 로직 (빌드 없음, 그대로 열면 동작) |
| `manifest.json`, `icons/`, `sw.js` | 홈 화면에 추가(PWA), 오프라인에서도 마지막 목록 열람 |
| `data/campaigns.json` | 필터를 통과한 모집 목록 (자동 생성) |
| `scripts/fetch_campaigns.py` | 파트너 API 수집 + 필터 + JSON 생성 (표준 라이브러리만 사용) |
| `ci/update.yml` | GitHub Actions 자동 갱신 워크플로 (아래 **자동 갱신 켜기** 참고) |
| `scripts/build_standalone.py` | 호스팅 없이 열 수 있는 단일 HTML 파일 빌드 |

## 보는 법

- 배포 URL(GitHub Pages 등)을 폰에서 열고, 브라우저 메뉴의 **홈 화면에 추가**로 앱처럼 쓴다.
- 상단: 갱신 시각 · 모집중 건수 · 신규 건수 · 신청 완료 건수 · 최고 당첨확률.
- 칩: `전체` / `오늘 신규` / `미신청만`, 정렬: `당첨확률 높은순` / `모집인원 많은순` / `마감임박순`, 키워드 검색.
- 카드의 **[모바일 신청 열기]** 를 누르면 체험단 모바일 페이지가 새 탭으로 열리고, 그 상품은 자동으로
  **신청 완료**로 체크된다(토스트의 `되돌리기` 또는 카드의 `완료` 버튼으로 해제 가능).
  체크 상태는 그 폰의 `localStorage` 에만 저장된다.

## 데이터

`data/campaigns.json`:

```json
{
  "updatedAt": "2026-11-21T02:26:50+09:00",
  "rawTotalCount": 420,
  "excludedCount": 90,
  "totalCount": 330,
  "newCount": 43,
  "newRule": "마감 6일 이상 남은 최신 등록분(모집 7일 기준)",
  "campaigns": [
    {
      "campaignId": "6ae18f5f291df432e3cde034",
      "title": "[끌리마] 행운을 부르는 액막이 명태 …",
      "brandName": "가구편집샵",
      "imageUrl": "https://st.kakaocdn.net/…jpg",
      "recruitmentCount": 10,
      "applicationCount": 2645,
      "winRate": 0.38,
      "endDate": "2026-11-27",
      "isNew": true,
      "mobileUrl": "https://gift.kakao.com/giftbox/trial-campaign/6ae18f5f291df432e3cde034",
      "remainingDays": 6,
      "category": "리빙 · 인테리어",
      "productId": 11149624
    }
  ]
}
```

- `winRate` = `min(100, 모집인원 / max(신청인원, 1) × 100)`
- `endDate` = 수집일 + API `remainingDays` (모집 기간이 7일이라 마감까지 6일 남은 묶음이 그날 새로 열린 배치)
- `isNew` = `remainingDays >= 6`

## 필터 기준 (내 기준)

- 제외 카테고리: `유아동·반려`, `뷰티 > 스킨케어·메이크업·향수`, `패션 > 주얼리·시계`
- 제외 키워드: 여성 전용(여성·여자·우먼·언더웨어·속옷·란제리…) — 단 `남자/남녀공용/커플` 표기가 있으면 유지,
  유아·임산부 전용 품목(신생아·유아용·키즈·베이비·기저귀·분유·유모차…)
- **반려견·반려동물 용품은 포함** (강아지·반려견·애견·고양이·펫 키워드가 있으면 카테고리와 무관하게 유지)

## 자동 갱신 켜기 (한 번만)

GitHub App 권한상 워크플로 파일은 자동으로 올릴 수 없어 `ci/update.yml` 로 두었다.
둘 중 하나로 `.github/workflows/update.yml` 에 옮기면 매일 10:05 KST 에 자동 갱신된다.

1. GitHub 웹 → 저장소 → **Add file → Create new file** → 이름 `.github/workflows/update.yml`,
   `ci/update.yml` 내용을 그대로 붙여넣고 커밋.
2. 첫 실행이 `403` 으로 실패하면 **Settings → Actions → General → Workflow permissions** 를
   *Read and write permissions* 로 바꾼 뒤 **Actions → Update trial campaigns → Run workflow**.

## 호스팅 / 폰에서 열기

- **GitHub Pages**: `https://han6389-del.github.io/kakao-trial-feed/`
  Settings → Pages → Source: `Deploy from a branch` → `main` / `/ (root)`.
  (Public 저장소라 무료로 바로 켜진다. Actions 로 배포하지 않으므로 별도 워크플로가 필요 없다.)
- **호스팅 없이**: `python3 scripts/build_standalone.py` → `dist/카카오-체험단-피드.html`
  (CSS·JS·데이터가 한 파일에 들어 있어 그냥 열면 된다. 데이터는 만든 시점 기준)

## 수동 실행

```bash
python3 scripts/fetch_campaigns.py                 # data/campaigns.json 갱신
python3 scripts/fetch_campaigns.py --dry-run       # 파일 쓰지 않고 통계만
python3 scripts/fetch_campaigns.py --show-excluded # 제외된 상품과 사유까지 출력
python3 scripts/build_standalone.py                # 단일 HTML 배포본 만들기
```

GitHub 웹에서 **Actions → Update trial campaigns → Run workflow** 로도 즉시 갱신할 수 있다.

## 참고

- 파트너 API `https://gift.kakao.com/a/partner-trial/api/v1/trial-campaigns` 는 `page=0` 이 첫 장이다
  (`page=1` 부터 받으면 최신 100건이 빠진다). `size=100` 까지 동작한다.
- 신청은 각 상품의 `mobileUrl` 로 열리는 **모바일** 페이지에서만 진행된다(2026-11-19 부터 PC 접속 차단).
