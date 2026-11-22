package com.kimgyeongmin.kakaotrialfeed;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import java.time.Duration;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.concurrent.TimeUnit;

/** 신규 체험단 확인 작업(24시간 주기, 매일 오전 10:20 KST 기준)을 WorkManager 에 등록한다. */
public final class CampaignCheckScheduler {

    private static final String WORK_NAME = "campaign-daily-check";
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final int CHECK_HOUR = 10;
    private static final int CHECK_MINUTE = 20;

    private CampaignCheckScheduler() {
    }

    public static void schedule(@NonNull Context context) {
        Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();

        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
                CampaignCheckWorker.class, 24, TimeUnit.HOURS)
                .setInitialDelay(millisUntilNextCheck(), TimeUnit.MILLISECONDS)
                .setConstraints(constraints)
                .addTag("campaign-check")
                .build();

        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, request);
    }

    /** 다음 10:20(KST) 까지 남은 시간. 오늘 10:20 이 지났으면 내일 10:20 이다. */
    static long millisUntilNextCheck() {
        ZonedDateTime now = ZonedDateTime.now(KST);
        ZonedDateTime target = now
                .withHour(CHECK_HOUR)
                .withMinute(CHECK_MINUTE)
                .withSecond(0)
                .withNano(0);
        if (!target.isAfter(now)) {
            target = target.plusDays(1);
        }
        return Duration.between(now, target).toMillis();
    }
}
