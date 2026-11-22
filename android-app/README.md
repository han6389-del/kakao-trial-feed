# 카카오 체험단 — Android 앱 (APK)

`https://han6389-del.github.io/kakao-trial-feed/` 피드를 폰 앱처럼 쓰기 위한 WebView 래퍼 앱입니다.

| 항목 | 값 |
| --- | --- |
| 앱 이름 | 카카오 체험단 |
| 패키지 | `com.kimgyeongmin.kakaotrialfeed` |
| minSdk / targetSdk | 26 / 34 |
| 빌드 | `assembleDebug` (자동 서명된 debug APK, 그대로 설치 가능) |
| APK 경로 | `android-app/app/build/outputs/apk/debug/app-debug.apk` |

## 기능

- **전체 화면 WebView**: 피드 페이지를 그대로 띄운다. `localStorage`(완료 체크·숨김)를 쓰므로
  `domStorageEnabled`, `javaScriptEnabled` 를 켜 두었다.
- **뒤로가기**: 웹 히스토리가 있으면 뒤로, 없으면 앱 종료. **당겨서 새로고침** 지원.
- **카카오톡 딥링크**:
  - `intent://` → `Intent.parseUri(url, Intent.URI_INTENT_SCHEME)` 로 파싱해 카카오톡 실행.
    미설치면 `browser_fallback_url` → Play 스토어(`com.kakao.talk`) → 설치 안내 순서로 처리.
  - `https://gift-talk.kakao.com/appredirect…`, `kakaotalk://`, `kakaolink://`, `kakaopay://` 등은
    `Intent(ACTION_VIEW)` 로 외부 앱(카카오톡)에 넘긴다.
  - 피드 페이지(`han6389-del.github.io`) 안의 이동은 WebView 안에서 처리한다.
- **신규 체험단 알림**: WorkManager 로 매일 **10:20(KST)** 에
  `data/campaigns.json` 을 확인해, `updatedAt` 이 지난번과 다르고 `newCount > 0` 이면
  "오늘 신규 체험단 N건 도착!" 알림을 띄운다(탭하면 앱 열림, 같은 데이터로 중복 알림 없음).
  Android 13+ 는 첫 실행 때 `POST_NOTIFICATIONS` 권한을 한 번 요청한다.

## 빌드

CI(GitHub Actions, `.github/workflows/android-apk.yml`)가 `android-app/**` 변경 시 자동으로 빌드해
`kakao-trial-feed-debug-apk` 아티팩트로 올린다. 손으로 빌드할 때는 JDK 17 + Gradle 8.7 이 필요하다.

```bash
cd android-app
gradle assembleDebug        # 또는 Android Studio 로 폴더 열고 Build > Build APK(s)
```

## 설치

1. 폰에서 APK 파일을 열고 "출처를 알 수 없는 앱 설치" 를 허용한다.
2. 설치 후 앱을 열면 피드가 뜨고, 알림 권한을 묻는 창이 한 번 나온다.
3. 체험단 카드의 **[모바일 신청 열기]** 를 누르면 카카오톡의 해당 체험단 화면으로 이동한다.

## 개인정보

소스·커밋에는 개인 이메일·실명·비밀값을 넣지 않는다(커밋 작성자는 저장소 공용 noreply 주소 사용).
앱이 저장하는 정보는 알림 중복 방지용 `updatedAt` 문자열과 알림 권한 요청 여부뿐이다.
