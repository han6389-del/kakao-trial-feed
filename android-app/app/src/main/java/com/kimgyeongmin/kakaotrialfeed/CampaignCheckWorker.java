package com.kimgyeongmin.kakaotrialfeed;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * data/campaigns.json 을 받아 updatedAt 이 지난번 확인 때와 다르고 newCount > 0 이면
 * "오늘 신규 체험단 N건 도착!" 로컬 알림을 띄운다.
 */
public class CampaignCheckWorker extends Worker {

    static final String DATA_URL =
            "https://han6389-del.github.io/kakao-trial-feed/data/campaigns.json";
    private static final String PREFS = "campaign_state";
    private static final String KEY_LAST_SEEN_UPDATED_AT = "last_seen_updated_at";
    private static final int MAX_BODY_CHARS = 2 * 1024 * 1024;

    public CampaignCheckWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(DATA_URL).openConnection();
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(20_000);
            connection.setRequestMethod("GET");
            connection.setUseCaches(false);
            connection.setRequestProperty("Cache-Control", "no-cache");
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("User-Agent", "KakaoTrialFeedApp/1.0");

            int status = connection.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK) {
                // 서버가 잠시 막아 둔 경우 — 다음 재시도에 맡긴다.
                return Result.retry();
            }

            String body = readBody(connection.getInputStream());
            if (body == null) {
                return Result.retry();
            }

            JSONObject json = new JSONObject(body);
            String updatedAt = json.optString("updatedAt", "");
            if (updatedAt.isEmpty()) {
                return Result.success();
            }
            int newCount = json.optInt("newCount", 0);
            int totalCount = json.optInt("totalCount", 0);

            SharedPreferences prefs = getApplicationContext()
                    .getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String lastSeen = prefs.getString(KEY_LAST_SEEN_UPDATED_AT, null);
            if (updatedAt.equals(lastSeen)) {
                return Result.success();
            }

            // 같은 데이터로 두 번 알리지 않도록 확인한 시각을 먼저 기록한다.
            prefs.edit().putString(KEY_LAST_SEEN_UPDATED_AT, updatedAt).apply();

            if (newCount > 0) {
                CampaignNotifier.notifyNewCampaigns(getApplicationContext(), newCount, totalCount);
            }
            return Result.success();
        } catch (IOException | JSONException e) {
            return Result.retry();
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private static String readBody(InputStream stream) throws IOException {
        if (stream == null) {
            return null;
        }
        StringBuilder builder = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            char[] buffer = new char[8192];
            int read;
            while ((read = reader.read(buffer)) != -1) {
                builder.append(buffer, 0, read);
                if (builder.length() > MAX_BODY_CHARS) {
                    return null;
                }
            }
        }
        return builder.toString();
    }
}
