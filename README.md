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
| `android-app/` | 폰 설치용 Android 앱(WebView 래퍼 + 신규 체험단 알림) Gradle 프로젝트 |
| `.github/workflows/android-apk.yml` | `android-app/**` 변경 시 debug APK 를 빌드해 아티팩트로 올리는 워크플로 |

## 보는 법

- 배포 URL(GitHub Pages 등)을 폰에서 열고, 브라우저 메뉴의 **홈 화면에 추가**로 앱처럼 쓴다.
- 상단: 갱신 시각 · 현재 탭 건수(라벨이 `미신청`/`오늘 신규`/`신청완료` 로 바뀐다) · 신규 건수 · 신청 완료 건수 · 최고 당첨확률.
- 칩: 상태 탭 `전체`(미신청만) / `오늘 신규`(미신청 신규만) / `신청완료`(체크한 것만, 건수 표시), 그 아래 카테고리
  `전체` / `식품` / `리빙` / `디지털` / `뷰티` / `패션` / `레저` / `반려` / `기타`(건수 표시, 가로 스크롤),
  정렬: `당첨확률 높은순` / `모집인원 많은순` / `마감임박순`, 키워드 검색. 상태·카테고리·검색·정렬은 **함께 조합**되어 동작한다.
- 카드의 **[완료 체크]** 를 누르면 그 상품이 목록에서 즉시 빠지며 `신청완료` 탭으로 옮겨진다.
  바로 뜨는 토스트의 **되돌리기**(4초)로 되돌릴 수 있고, `신청완료` 탭에서 **[↩ 미신청으로]** 로 체크를 해제하면 다시 `전체` 목록으로 돌아온다.
  체크 상태는 그 폰의 `localStorage` 에만 저장된다.
- 카드의 **[모바일 신청 열기]** 를 누르면 카카오톡 앱이 열리며 그 체험단의 **신청 화면으로 바로** 간다. 그 상품은 같이 자동으로
  **신청완료**로 옮겨진다(같은 토스트의 `되돌리기` 또는 `신청완료` 탭의 해제 버튼으로 복구).
- 카드 오른쪽 아래줄 **[✕ 숨기기]** 를 누르면 그 상품이 목록에서 빠진다(마음에 안 드는 상품 정리용).
  바로 뜨는 토스트의 **되돌리기**(4초)로 한 번에 복구되고, 4초가 지나도 하단 안내의
  **숨긴 상품 N개 모두 되돌리기** 로 되살릴 수 있다. 숨김은 `localStorage` 의 `kt_hidden_v1` 에만 저장되며
  목록·상단 수치(탭 건수·`신규`·`최고 확률`)·카테고리 칩 건수에서 모두 빠진다.

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
      "mobileUrl": "https://gift-talk.kakao.com/appredirect?to=https%253A%252F%252Fgift.kakao.com%252Fgiftbox%252Ftrial-campaign%252F6ae18f5f291df432e3cde034&input_channel_id=13478",
      "remainingDays": 6,
      "category": "리빙 · 인테리어",
      "productId": 11149624
    }
  ]
}
```

- `mobileUrl` = **카카오톡 앱 직행 딥링크**다(아래 **신청 링크** 참고). 형식: `https://gift-talk.kakao.com/appredirect?to={이중 인코딩한 상품 URL}&input_channel_id=13478`
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

## 검증 (숨김·신청완료 분리)

빌드 도구 없이 QuickJS(파이썬 `quickjs` 패키지)로 `app.js` 를 그대로 불러 돌린다. 실제 `data/campaigns.json` 을 쓴다.

```bash
pip install quickjs
python3 tests/run_hide_test.py   # 순수 로직: 숨김·탭 분리(전체/오늘 신규/신청완료)·건수/칩 재계산·카드 마크업 (47개)
python3 tests/run_ui_test.py     # 화면 흐름: 가짜 DOM 에서 숨기기·완료 체크→토스트 되돌리기·탭 이동·재로드 유지 (52개)
```

GitHub 웹에서 **Actions → Update trial campaigns → Run workflow** 로도 즉시 갱신할 수 있다.

## 안드로이드 앱 (APK)

`android-app/` 은 이 피드를 폰 앱으로 쓰기 위한 WebView 래퍼다(앱 이름 `카카오 체험단`, `com.kimgyeongmin.kakaotrialfeed`, minSdk 26 / targetSdk 34).

- 매일 10:20(KST) 에 `data/campaigns.json` 을 확인해 신규 건수가 있으면 "오늘 신규 체험단 N건 도착!" 알림을 띄운다(Android 13+ 알림 권한 필요).
- **[모바일 신청 열기]** 의 `gift-talk.kakao.com/appredirect` 링크와 `intent://` 딥링크를 카카오톡 앱으로 넘긴다.
- 빌드는 GitHub Actions(`android-app/**` push 또는 수동 실행)가 하고, 결과는 `kakao-trial-feed-debug-apk` 아티팩트에서 받는다. 자세한 내용은 `android-app/README.md`.

## 참고

- 파트너 API `https://gift.kakao.com/a/partner-trial/api/v1/trial-campaigns` 는 `page=0` 이 첫 장이다
  (`page=1` 부터 받으면 최신 100건이 빠진다). `size=100` 까지 동작한다.
- 신청은 각 상품의 `mobileUrl` 로 열리는 **모바일** 페이지에서만 진행된다(2026-11-19 부터 PC 접속 차단).

## 카테고리 묶음 규칙

`category` 는 `"대분류 · 소분류"` 형태(예: `리빙 · 주방·수입주방`)라 소분류가 47가지다. 칩은 **대분류 8묶음**으로 묶는다
(`app.js` 의 `CAT_GROUPS` · `groupKeyOf()`).

| 칩 | 매칭되는 `category` | 현재 건수(2026-11-21 데이터) |
| --- | --- | --- |
| `식품` | `식품 · …` | 65 |
| `리빙` | `리빙 · …` | 120 |
| `디지털` | `디지털·가전 · …` | 63 |
| `뷰티` | `뷰티 · …` | 37 |
| `패션` | `패션 · …` | 33 |
| `레저` | `레저·스포츠 · …` | 11 |
| `반려` | `유아동·반려`(·`반려`·`유아동`)로 시작하는 것 | 1 |
| `기타` | 위에 안 걸리는 모든 것 | 0 |

- 분류가 **비어 있는** 상품(핫팩·물주머니·양말 등 7건)은 상품명 키워드로 `리빙` 에 넣는다. 그래도 못 정하면 `기타` 로 보내. 
- 반려견·고양이 **그림·모양 상품**(바디필로우·무드등·사쉐 등)은 반려용품이 아니라 침구·조명·소품이므로 원래 대분류에 둔다. 
  지금 데이터에서 진짜 `유아동·반려` 분류로 남은 건 1건(디지털펫 장난감)이다.
- 칩의 건수는 **현재 상태 탭·검색어를 반영하고 카테고리 조건만 뺀** 수치라서, 다른 카테고리로 바꾸면 몇 건인지 미리 보인다(0건이면 칩이 흐려진다).

## 신청 링크 (앱 직행 딥링크)

`gift.kakao.com/giftbox/trial-campaign/{id}` 를 폰 브라우저에서 열면 카카오톡으로 넘어가지 않고 선물하기 홈으로 떨어진다.
카카오 공식 앱링크(`kko.to` 단축링크가 301 로 보내는 주소)를 그대로 쓰면 카카오톡 앱의 해당 상품 신청 화면으로 직행한다.

```
https://gift-talk.kakao.com/appredirect?to=https%253A%252F%252Fgift.kakao.com%252Fgiftbox%252Ftrial-campaign%252F{campaignId}&input_channel_id=13478
```

- `to` 값은 **이중 인코딩**이다. `appredirect` 는 받은 `to` 를 그대로 `intent://gift/home?to=...#Intent;scheme=kakaotalk;package=com.kakao.talk;end` 에 실어 카카오톡을 열기 때문에, 한 번만 인코딩하면 앱에서 상품을 못 찾는다.
- 생성은 `scripts/fetch_campaigns.py` 의 `mobile_url()`(=`urllib.parse.quote` 2회)과 `app.js` 의 `KT.deepLink()`(`encodeURIComponent` 2회) 두 곳에서 하고, 결과 문자열은 서로 같다.
- `app.js` 는 JSON 의 `mobileUrl` 대신 `campaignId` 로 링크를 다시 만든다. 예전 주소가 캐시에 남아 있어도 앱으로 직행한다.
- 카카오톡이 안 열리면 `appredirect` 페이지의 “카카오톡 선물하기로 이동” 버튼을 한 번 눌러 주면 된다.

