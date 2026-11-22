package com.kimgyeongmin.kakaotrialfeed;

import android.app.Application;

/**
 * 앱 시작 시 알림 채널을 만들고, 매일 오전 10:20(KST) 신규 체험단 확인 작업을 등록한다.
 * 등록은 여러 번 호출해도 같은 작업 하나로 유지된다(ExistingPeriodicWorkPolicy.UPDATE).
 */
public class App extends Application {

    @Override
    public void onCreate() {
        super.onCreate();
        CampaignNotifier.ensureChannel(this);
        CampaignCheckScheduler.schedule(this);
    }
}
