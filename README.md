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
- 카드의 **[모바일 신청 열기]** 를 누르면 카카오톡 앱이 열리며 그 체험단의 **신청 화면으로 바로** 간다.
  그 상품은 기억해 두었다가, 카톡에서 **돌아오는 순간 하단 배너**에서 **[✅ 완료 처리]** 한 번으로 `신청완료`로 옮긴다
  (신청을 안 했으면 **[닫기]**). 자세한 동작은 아래 **카톡 복귀 원탭 확인** 참고.
- 카드 오른쪽 아래줄 **[✕ 숨기기]** 를 누르면 그 상품이 목록에서 빠진다(마음에 안 드는 상품 정리용).
  바로 뜨는 토스트의 **되돌리기**(4초)로 한 번에 복구되고, 4초가 지나도 하단 안내의
  **숨긴 상품 N개 모두 되돌리기** 로 되살릴 수 있다. 숨김은 `localStorage` 의 `kt_hidden_v1` 에만 저장되며
  목록·상단 수치(탭 건수·`신규`·`최고 확률`)·카테고리 칩 건수에서 모두 빠진다.
- 하단 안내의 **기록 옮기기 (복사 / 붙여넣기)** 는 이 브라우저에만 쌓인 **신청완료·숨김**을 다른 기기(새로 깐 앱 등)로
  한 번 옮기는 용도다. ① **내 기록 복사하기** → ② 다른 기기에서 붙여넣고 **불러오기 (합치기)** 또는 **덮어쓰기**.
  자세한 형식은 아래 **기록 옮기기** 참고.
- 정렬 줄의 **[🚫 제외]** 는 내가 정한 키워드(예: 여성·아동·화장품)가 상품명·브랜드·카테고리에 들어간 상품을
  `전체`·`오늘 신규` 목록과 건수에서 빼 준다(`신청완료` 탭은 그대로). 자세한 동작은 아래 **제외 키워드** 참고.
- `신청완료` 탭은 **발표일 가까운 순**(오늘 발표가 맨 위)으로 보여 주고, 카드마다 발표일 배지가 붙는다.
  `🎉 오늘 11시 발표` / `발표 11/23 11시`. 발표일(마감 다음 날 11시)이 지나면 자동으로 정리된다 — 아래 **발표일 배지 · 자동 정리** 참고.

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

## 검증 (숨김·신청완료 분리·기록 옮기기)

빌드 도구 없이 QuickJS(파이썬 `quickjs` 패키지)로 `app.js` 를 그대로 불러 돌린다. 실제 `data/campaigns.json` 을 쓴다.

```bash
pip install quickjs
python3 tests/run_hide_test.py     # 순수 로직: 숨김·탭 분리(전체/오늘 신규/신청완료)·건수/칩 재계산·카드 마크업 (47개)
python3 tests/run_transfer_test.py # 기록 옮기기: pack→unpack 왕복(379건)·형식 관용·오류 처리·merge 불변성 (49개)
python3 tests/run_exclude_test.py  # 제외 키워드: 입력 파싱·부분일치·탭별 적용 범위·백업 K 줄 왕복·복귀 배너 조건 (76개)
python3 tests/run_announce_test.py # 발표일: 배지(오늘/앞으로/M/D)·KST 자정·스냅샷·보강·자동 정리·카드 복원 (88개)
python3 tests/run_ui_test.py       # 화면 흐름: 숨기기·완료 체크·탭 이동·재로드 유지·발표 당일 유지/다음 날 정리·옮기기/제외 시트·복귀 배너 (174개)
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

## 기록 옮기기 (복사 / 붙여넣기)

신청완료·숨김은 `localStorage` 라 **브라우저(크롬)와 새로 깐 APK 의 WebView 저장소가 서로 다르다**. 그래서 한쪽 기록을
다른 쪽으로 옮기는 1회용 통로를 둔다.

- 화면 맨 아래 **기록 옮기기 (복사 / 붙여넣기)** → 바텀 시트.
- ① **내 기록 복사하기**: `navigator.clipboard.writeText` 로 복사하고, 막히면(일부 WebView·http) `execCommand("copy")`,
  그것도 안 되면 칸의 글자를 길게 눌러 직접 복사하도록 안내한다. 복사한 글자는 아래 칸에도 남겨 둔다.
- ② 다른 기기에서 그 글자를 칸에 붙여넣고 **불러오기 (합치기)**(기존 기록 유지) 또는 **덮어쓰기**(이 기기 기록을 지우고 붙여넣은 것만).
- 형식(`app.js` 의 `packRecords()` / `unpackRecords()`)은 사람이 읽어도 되는 짧은 글자다.

```
KTF1
A 6aba2c47ad768a1dd2e71cbc,6af18d59aa5814e6d0742dc2
H 6ae84eb0aa5814e6d0742d4e
```

- 첫 줄 `KTF1` 은 머리말, `A` 는 신청완료, `H` 는 숨김이다. 한 줄에 40개씩 나눠 쓰고, 읽을 때는 여러 줄을 합친다.
- 읽을 때 `applied:` / `hidden:` 이름, 쉼표·공백 구분, BOM·CRLF·`#` 주석도 그대로 받는다. 형식에 안 맞는 글자나
  `__proto__` 같은 이름은 조용히 버리고, 읽을 기록이 0건이면 "옮길 기록을 찾지 못했어요" 로 알린다.
- 옮긴 기록의 시각은 **불러온 날**로 다시 찍는다(신청완료 45일·숨김 60일 보관 기준을 그때부터 새로 센다).
- 저장 키는 신청완료 `ktApp.applied.v1`, 숨김 `kt_hidden_v1` 이다.

## 카톡 복귀 원탭 확인 (하단 배너)

`카톡으로 열기` 로 나간 상품을 기억해 두고, 앱·브라우저로 **돌아오는 순간** 하단에
`방금 연 "○○" 신청했나요?` 배너를 띄운다. 제목이 길면 두 줄에서 말줄임.

- **[✅ 완료 처리]** → 즉시 `신청완료`(목록에서 빠지고 탭·칩 건수 갱신, 토스트의 `되돌리기` 4초)
- **[닫기]** → 배너만 닫고 기억을 지운다(완료 처리 안 함)
- 기억은 `sessionStorage` 와 `localStorage` 의 `kt_last_open_v1` 에 같이 적고, **30분**이 지나거나
  이미 완료·숨김 처리된 상품이면 묻지 않는다. 완료·닫기 때 양쪽 모두 지운다.
  (`localStorage` 쪽은 카톡에 있는 사이 안드로이드 웹뷰가 메모리에서 내려가 페이지가 새로 떠도 배너가 뜨게 하려는 것)
- 돌아오는 순간은 `visibilitychange`(document) · `pageshow` · `focus`(window) 로 본다.
  `pageshow` 는 Window 이벤트라 반드시 `window` 에 걸어야 한다(document 에 걸면 오지 않는다).
- 배너가 떠 있는 동안 되돌리기 토스트는 배너 위로 올라가 겹치지 않는다(`body.has-retbar`).

## 제외 키워드

정렬 줄의 **[🚫 제외]** → 바텀 시트. 등록한 키워드는 **이 폰에만**(`localStorage` `kt_excluded_kw_v1`, JSON 배열) 저장된다.

- 입력칸 + **[추가]**(Enter 지원, 쉼표로 여러 개: `여성, 아동, 화장품`) → 칩으로 표시, 칩의 **✕** 로 하나씩 삭제, **모두 지우기**.
- 키워드는 **30개**, 한 개 **20자**까지. 대소문자 무시 **부분일치**로 `title`·`brandName`·`category` 를 본다.
- 걸린 상품은 `전체` · `오늘 신규` **목록과 건수(상단 수치·탭 건수·카테고리 칩·노출 건수)** 에서 빠진다.
  `신청완료` 탭은 그대로 보인다(이미 신청한 기록은 숨기지 않는다).
- 목록이 비었을 때 제외 키워드 때문이면 그 사실과 함께 시트를 여는 버튼을 보여 준다.
- **기록 옮기기** 백업에 `K 키워드,키워드…` 줄로 함께 실린다. `K` 줄이 없는 예전 백업도 그대로 읽고,
  그 경우 **덮어쓰기**를 해도 이 기기의 제외 키워드는 지우지 않는다(합치기는 더한다).

## 발표일 배지 · 자동 정리 (신청완료)

카카오 선물하기 체험단은 **마감일(`endDate`) 다음 날 11:00** 에 당첨자를 발표한다. 그래서 `신청완료` 탭은
발표가 끝날 때까지 기록을 붙들고 있다가 다음 날 스스로 정리한다.

- **[완료 체크]할 때 상품 정보를 함께 저장한다** (`state.applied[id]` = `{ at, title, brandName, imageUrl,
  endDate, mobileUrl, category, recruitmentCount, applicationCount, winRate, productId }`).
  `campaigns.json` 은 매일 10:15 갱신이라 마감이 지난 상품이 빠지는데, 그때도 저장해 둔 값으로 카드를 다시 그린다.
- **예전 체크분 보강(hydrate)**: 예전 버전에서 `{ at }` 만 저장된 기록은 목록을 불러올 때 `campaigns.json` 값으로
  빈 칸만 채워 넣고 저장한다(이미 있는 값은 덮지 않는다).
- **발표일 배지**: `🎉 오늘 11시 발표`(오늘 = 마감 다음 날, 초록 강조·맥박) / `발표 11/23 11시` / (지난 것은 `발표 끝남`).
- **정렬**: `신청완료` 탭은 정렬 선택과 무관하게 발표일 가까운 순 — 오늘 발표가 맨 위, 그다음 앞으로의 발표일,
  이미 지난 발표·마감일을 모르는 옛 기록은 뒤로(지난 것은 다음 정리 때 사라진다).
  탭 배지 숫자(`cDone`)·상단 `신청 완료` 수치도 이 목록에 실제로 보이는 건수와 같다.
- **자동 정리(prune)**: KST 오늘이 발표일 **다음 날 이후**인 기록(`todayKST > endDate + 1`)은 저장소에서 지운다.
  목록을 불러올 때·카톡에서 돌아올 때(`visibilitychange`·`pageshow`·`focus`) 확인하고, 지운 게 있으면
  `발표일이 지난 N건을 신청완료에서 정리했어요` 토스트로 알린다.
- **마감일이 없는 옛 기록**(발표일을 계산할 수 없는 것)은 지우지 않고 저장만 유지한다(45일 보관 규칙이 정리).
  카드로 되살리지는 않는다.
- `기록 옮기기`로 옮겨 온 기록도 같은 규칙을 따른다(합칠 때 붙여넣은 쪽에 없는 스냅샷 값은 남긴다).

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

