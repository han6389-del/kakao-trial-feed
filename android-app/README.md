# 카카오 체험단 — Android 앱 (APK)

`https://han6389-del.github.io/kakao-trial-feed/` 피드를 폰 앱처럼 쓰기 위한 WebView 래퍼 앱입니다.

| 항목 | 값 |
| --- | --- |
| 앱 이름 | 카카오 체험단 |
| 패키지 | `com.kimgyeongmin.kakaotrialfeed` |
| minSdk / targetSdk | 26 / 34 |
| 버전 | versionCode 2 · versionName 1.1 |
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
- **분할 화면(갤럭시 Z 폴드) 지원**: `android:resizeableActivity="true"`,
  분할 화면에서 카톡을 열면 `FLAG_ACTIVITY_LAUNCH_ADJACENT | FLAG_ACTIVITY_NEW_TASK` 로
  **옆 칸**에 띄워 피드가 그대로 남는다. 웹(피드)에는 `AndroidSplitBridge` 다리를 노출한다.
  - `AndroidSplitBridge.isMultiWindow()` → 지금 분할 화면인지
  - `AndroidSplitBridge.openKakaoAdjacent()` → 분할 화면이면 카톡을 옆 칸에 열고 `true`, 전체 화면이면 `false`
  - 헤더의 `🪟 분할 카톡` 버튼은 이 다리가 있을 때(앱)만 보이고, 전체 화면이면 앱 페어 저장 안내를 띄운다.
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

> **서명(업데이트) 주의**: debug APK 는 빌드한 기계의 `~/.android/debug.keystore` 로 서명된다. 키가 다르면
> 안드로이드가 기존 앱 위에 설치를 거부하므로(`앱이 설치되지 않음`), 기록(`localStorage`)을 지키려면
> **같은 키로 빌드한 APK** 로 업데이트해야 한다. GitHub Actions 러너는 실행마다 키를 새로 만들어
> 서명이 달라진다 — 덮어쓰기 설치가 필요하면 이 프로젝트를 빌드해 둔 작업 공간에서 `gradle assembleDebug` 로 만든다.

## 개인정보

소스·커밋에는 개인 이메일·실명·비밀값을 넣지 않는다(커밋 작성자는 저장소 공용 noreply 주소 사용).
앱이 저장하는 정보는 알림 중복 방지용 `updatedAt` 문자열과 알림 권한 요청 여부뿐이다.
