package com.kimgyeongmin.kakaotrialfeed;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Looper;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ProgressBar;
import android.widget.Toast;

import androidx.core.content.ContextCompat;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import java.net.URISyntaxException;
import java.util.Locale;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * 카카오 체험단 피드(https://han6389-del.github.io/kakao-trial-feed/)를 전체 화면 WebView 로 보여주고,
 * 카카오톡 딥링크를 카카오톡 앱으로 넘긴다.
 */
public class MainActivity extends Activity {

    static final String HOME_URL = "https://han6389-del.github.io/kakao-trial-feed/";
    private static final String SITE_HOST = "han6389-del.github.io";
    private static final String KAKAO_TALK_PACKAGE = "com.kakao.talk";
    private static final int REQUEST_POST_NOTIFICATIONS = 1001;
    private static final String APP_PREFS = "app_state";
    private static final String KEY_PERMISSION_ASKED = "notification_permission_asked";
    /** 웹(피드)이 분할 화면 상태를 묻고 카톡을 옆 칸에 띄울 때 쓰는 다리 이름 */
    private static final String SPLIT_BRIDGE = "AndroidSplitBridge";

    private WebView webView;
    private SwipeRefreshLayout swipeRefresh;
    private ProgressBar progressBar;
    private View errorPanel;
    private boolean loadFailed;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webview);
        swipeRefresh = findViewById(R.id.swipe_refresh);
        progressBar = findViewById(R.id.progress_bar);
        errorPanel = findViewById(R.id.error_panel);

        swipeRefresh.setColorSchemeColors(0xFFFFE812, 0xFF3C1E1E, 0xFF2F2F2F);
        swipeRefresh.setOnRefreshListener(() -> {
            loadFailed = false;
            errorPanel.setVisibility(View.GONE);
            webView.reload();
        });

        View retryButton = findViewById(R.id.retry_button);
        retryButton.setOnClickListener(view -> {
            loadFailed = false;
            errorPanel.setVisibility(View.GONE);
            progressBar.setVisibility(View.VISIBLE);
            webView.loadUrl(HOME_URL);
        });

        configureWebView();
        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(HOME_URL);
        }
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        // target=_blank 링크도 같은 WebView 로 받아 shouldOverrideUrlLoading 에서 처리한다.
        settings.setSupportMultipleWindows(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " KakaoTrialFeedApp/1.1");

        // 분할 화면에서 카톡을 옆 칸에 띄우고, 전체 화면이면 웹이 앱 페어 안내를 띄울 수 있게 한다.
        // (WebView 안에서는 피드 페이지(han6389-del.github.io)만 열린다)
        webView.addJavascriptInterface(new SplitBridge(), SPLIT_BRIDGE);

        webView.setBackgroundColor(0xFFFFFFFF);
        webView.setWebViewClient(new AppWebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                if (newProgress >= 100) {
                    progressBar.setVisibility(View.GONE);
                } else {
                    progressBar.setVisibility(View.VISIBLE);
                    progressBar.setProgress(newProgress);
                }
            }
        });
    }

    /* ── URL 처리 ───────────────────────────────────────────── */

    /**
     * @return true 면 WebView 가 직접 처리하지 않고(외부 앱/브라우저로 넘김) 끝난 것.
     */
    private boolean handleUrl(String url) {
        if (url == null || url.isEmpty()) {
            return false;
        }
        String lower = url.toLowerCase(Locale.ROOT);

        if (lower.startsWith("intent:")) {
            return handleIntentUrl(url);
        }

        if (lower.startsWith("http://") || lower.startsWith("https://")) {
            Uri uri = Uri.parse(url);
            String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
            if (SITE_HOST.equals(host) || host.endsWith("." + SITE_HOST)) {
                // 피드 페이지 자체는 앱 안에서 그대로 연다.
                return false;
            }
            // gift-talk.kakao.com/appredirect 처럼 카카오톡으로 넘어가는 링크는 외부 앱에 맡긴다.
            return openExternally(url);
        }

        // kakaotalk://, kakaolink://, kakaopay://, market://, tel:, mailto: 등
        return openExternally(url);
    }

    /** intent:// 스킴을 카카오톡 앱 실행으로 연결하고, 미설치면 fallback 을 처리한다. */
    private boolean handleIntentUrl(String url) {
        Intent intent;
        try {
            intent = Intent.parseUri(url, Intent.URI_INTENT_SCHEME);
        } catch (URISyntaxException e) {
            return false;
        }
        intent.addCategory(Intent.CATEGORY_BROWSABLE);
        intent.setComponent(null);
        intent.setSelector(null);

        try {
            startActivity(withAdjacentFlags(intent));
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            String fallbackUrl = intent.getStringExtra("browser_fallback_url");
            if (fallbackUrl != null && !fallbackUrl.isEmpty()) {
                webView.loadUrl(fallbackUrl);
                return true;
            }
            String packageName = intent.getPackage();
            if (KAKAO_TALK_PACKAGE.equals(packageName)) {
                promptInstallKakaoTalk();
            } else if (packageName != null && !packageName.isEmpty()) {
                openPlayStore(packageName);
            } else {
                toast(getString(R.string.error_no_app));
            }
            return true;
        }
    }

    /** http(s)·커스텀 스킴을 시스템 기본 앱(카카오톡/브라우저)으로 넘긴다. */
    private boolean openExternally(String url) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            startActivity(withAdjacentFlags(intent));
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            String lower = url.toLowerCase(Locale.ROOT);
            if (lower.startsWith("kakaotalk:") || lower.startsWith("kakaolink:")) {
                promptInstallKakaoTalk();
            } else {
                toast(getString(R.string.error_no_app));
            }
            return true;
        }
    }

    /* ── 분할 화면(갤럭시 폴드) ────────────────────────────────
     * 분할 화면에서 카톡을 그냥 열면 이 앱 자리를 카톡이 덮어써 버린다.
     * 분할 화면일 때는 LAUNCH_ADJACENT 로 옆 칸에 띄워 피드가 그대로 남게 한다. */

    private boolean inSplitScreen() {
        return isInMultiWindowMode();
    }

    /** 분할 화면일 때만 '옆 칸'에 새 창을 띄우는 플래그를 붙인다. */
    private Intent withAdjacentFlags(Intent intent) {
        if (inSplitScreen()) {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_LAUNCH_ADJACENT);
        }
        return intent;
    }

    /** JS 다리는 메인 스레드가 아니므로, 화면 상태 확인·실행은 메인 스레드에서 하고 결과만 돌려준다. */
    private <T> T onMainThread(Callable<T> task, T fallback) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            try {
                return task.call();
            } catch (Exception e) {
                return fallback;
            }
        }
        final Object[] box = new Object[1];
        final CountDownLatch latch = new CountDownLatch(1);
        runOnUiThread(() -> {
            try {
                box[0] = task.call();
            } catch (Exception ignored) {
                // fallback
            }
            latch.countDown();
        });
        try {
            latch.await(1, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        @SuppressWarnings("unchecked") T result = (T) box[0];
        return result == null ? fallback : result;
    }

    /** 웹(피드)에서 부르는 다리 — 분할 화면 여부 확인과 카톡 옆 칸 열기만 노출한다. */
    private final class SplitBridge {

        @JavascriptInterface
        public boolean isMultiWindow() {
            return onMainThread(MainActivity.this::inSplitScreen, Boolean.FALSE);
        }

        @JavascriptInterface
        public boolean openKakaoAdjacent() {
            return onMainThread(MainActivity.this::openKakaoAdjacentNow, Boolean.FALSE);
        }
    }

    /** 전체 화면이면 false — 웹이 '앱 페어' 안내를 띄운다. 분할 화면이면 카톡을 옆 칸에 띄운다. */
    private boolean openKakaoAdjacentNow() {
        if (!inSplitScreen()) {
            return false;
        }
        Intent launch = getPackageManager().getLaunchIntentForPackage(KAKAO_TALK_PACKAGE);
        if (launch == null) {
            promptInstallKakaoTalk();
            return false;
        }
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_LAUNCH_ADJACENT);
        try {
            startActivity(launch);
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            return false;
        }
    }

    private void promptInstallKakaoTalk() {
        if (isFinishing()) {
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle(R.string.kakaotalk_missing_title)
                .setMessage(R.string.kakaotalk_missing_message)
                .setPositiveButton(R.string.kakaotalk_missing_install, (dialog, which) -> {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW,
                                Uri.parse("market://details?id=" + KAKAO_TALK_PACKAGE)));
                    } catch (ActivityNotFoundException | SecurityException e) {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(
                                "https://play.google.com/store/apps/details?id=" + KAKAO_TALK_PACKAGE)));
                    }
                })
                .setNegativeButton(android.R.string.cancel, null)
                .show();
    }

    private void openPlayStore(String packageName) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW,
                    Uri.parse("market://details?id=" + packageName)));
        } catch (ActivityNotFoundException | SecurityException e) {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(
                    "https://play.google.com/store/apps/details?id=" + packageName)));
        }
    }

    private void toast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }

    /* ── WebView 클라이언트 ─────────────────────────────────── */

    private final class AppWebViewClient extends WebViewClient {

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return handleUrl(request.getUrl().toString());
        }

        @Override
        @SuppressWarnings("deprecation")
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return handleUrl(url);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            swipeRefresh.setRefreshing(false);
            progressBar.setVisibility(View.GONE);
            if (!loadFailed) {
                errorPanel.setVisibility(View.GONE);
            }
            requestNotificationPermissionOnce();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) {
                loadFailed = true;
                swipeRefresh.setRefreshing(false);
                progressBar.setVisibility(View.GONE);
                errorPanel.setVisibility(View.VISIBLE);
            }
        }
    }

    /* ── 알림 권한 ──────────────────────────────────────────── */

    /** Android 13+ 알림 권한을 처음 한 번만 요청한다(피드가 처음 뜬 뒤에). */
    private void requestNotificationPermissionOnce() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return;
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) {
            return;
        }
        SharedPreferences prefs = getSharedPreferences(APP_PREFS, MODE_PRIVATE);
        if (prefs.getBoolean(KEY_PERMISSION_ASKED, false)) {
            return;
        }
        prefs.edit().putBoolean(KEY_PERMISSION_ASKED, true).apply();
        webView.postDelayed(() -> {
            if (!isFinishing()
                    && ContextCompat.checkSelfPermission(MainActivity.this,
                    Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(
                        new String[]{Manifest.permission.POST_NOTIFICATIONS},
                        REQUEST_POST_NOTIFICATIONS);
            }
        }, 1200);
    }

    /* ── 생명주기 ───────────────────────────────────────────── */

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) {
            webView.saveState(outState);
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onPause() {
        if (webView != null) {
            webView.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.setWebViewClient(new WebViewClient());
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
