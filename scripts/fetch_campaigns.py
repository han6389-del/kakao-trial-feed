#!/usr/bin/env python3
"""카카오 선물하기 체험단(트라이얼) 모집 목록을 수집해 data/campaigns.json 을 만든다.

- 파트너 API 는 브라우저 없이 표준 라이브러리만으로 호출된다.
- 페이지네이션은 0-indexed 이며, page=1 부터 시작하면 앞쪽 최신 100건이 통째로 빠진다.
- 내 기준(여성 화장품/스킨케어/메이크업/향수, 여성 의류/언더웨어/주얼리,
  유아동/아기/임산부 용품 제외 · 반려견 용품 포함)으로 걸러낸다.

사용:
    python3 scripts/fetch_campaigns.py                 # data/campaigns.json 갱신
    python3 scripts/fetch_campaigns.py --dry-run       # 파일 쓰지 않고 통계만
    python3 scripts/fetch_campaigns.py --show-excluded # 제외 목록까지 출력
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

API_URL = "https://gift.kakao.com/a/partner-trial/api/v1/trial-campaigns"

# 카카오톡 앱 직행 딥링크.
# gift.kakao.com 의 모바일 페이지는 앱으로 넘기지 못하고 선물하기 홈으로 떨어지므로,
# 카카오 공식 앱링크(kko.to 단축링크가 301 로 보내는 주소)를 그대로 쓴다.
#   https://gift-talk.kakao.com/appredirect?to={이중 인코딩한 상품 URL}&input_channel_id=13478
# appredirect 는 to 값을 그대로 intent://gift/home?to=... 에 실어 카카오톡을 열기 때문에
# to 는 반드시 두 번 인코딩해야 한다(https -> https%253A%252F%252F...).
APP_REDIRECT_URL = "https://gift-talk.kakao.com/appredirect"
APP_INPUT_CHANNEL_ID = "13478"
TRIAL_PATH = "https://gift.kakao.com/giftbox/trial-campaign/{campaign_id}"
PAGE_SIZE = 100
MAX_PAGES = 60
KST = timezone(timedelta(hours=9))
USER_AGENT = (
    "Mozilla/5.0 (Linux; Android 14; SM-F958N) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
)

# --- 내 제외 기준 -------------------------------------------------------
# 통째로 제외하는 대분류 (단, 반려동물 용품은 아래 PET_KEYWORDS 로 구제한다)
EXCLUDE_LDISPLAY = {"유아동·반려"}

# 통째로 제외하는 (대분류, 중분류)
EXCLUDE_SUBCATEGORY = {
    ("뷰티", "스킨케어"),
    ("뷰티", "메이크업"),
    ("뷰티", "향수"),
    ("패션", "주얼리·시계"),
}

# 반려동물 용품은 유아동·반려 안에 있어도 신청 대상이다.
PET_KEYWORDS = ["강아지", "반려견", "반려동물", "애견", "고양이", "댕댕", "펫", "dog", "cat"]

# 여성 전용으로 보이는 상품 (남자/남녀공용/커플 표기가 있으면 살린다)
FEMALE_KEYWORDS = [
    "여성", "여자", "우먼", "레이디", "women", "woman", "ladies",
    "언더웨어", "속옷", "브래지어", "브라렛", "브라탑", "란제리", "슬립웨어", "캐미솔",
]
UNISEX_KEYWORDS = ["남자", "남성", "남녀", "공용", "커플", "유니섹스", "men", "unisex"]

# 유아·임산부 전용 상품 유형 (선물 문구에 스치는 '출산/육아' 같은 말은 잡지 않는다)
KIDS_KEYWORDS = [
    "신생아", "유아용", "유아", "키즈", "베이비", "아동용", "이유식", "분유",
    "기저귀", "젖병", "유모차", "카시트", "수유패드", "조리원", "임산부용", "돌잔치",
]

# 신규 판정: 모집 기간이 7일이라 마감까지 6일 이상 남은 묶음이 가장 최근 등록분이다.
NEW_MIN_REMAINING_DAYS = 6


def mobile_url(campaign_id: str) -> str:
    """카카오톡 앱의 해당 체험단 신청 화면으로 직행하는 딥링크."""
    target = TRIAL_PATH.format(campaign_id=campaign_id)
    encoded = urllib.parse.quote(urllib.parse.quote(target, safe=""), safe="")
    return f"{APP_REDIRECT_URL}?to={encoded}&input_channel_id={APP_INPUT_CHANNEL_ID}"


def fetch_page(page: int, retries: int = 4) -> dict:
    url = f"{API_URL}?page={page}&size={PAGE_SIZE}"
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=25) as res:
                return json.loads(res.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc
            wait = 2 ** attempt
            print(f"  ! page {page} 실패({exc}) — {wait}s 후 재시도", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError(f"page {page} 조회 실패: {last_error}")


def fetch_all() -> list[dict]:
    items: list[dict] = []
    seen: set[str] = set()
    for page in range(MAX_PAGES):
        data = fetch_page(page)
        contents = data.get("contents") or []
        for raw in contents:
            cid = raw.get("campaignId")
            if cid and cid not in seen:
                seen.add(cid)
                items.append(raw)
        if data.get("isLast") or not contents:
            break
        time.sleep(0.25)
    return items


def _category(raw: dict) -> tuple[str, str]:
    views = raw.get("displayCategoryViews") or []
    rep = next((v for v in views if v.get("representative")), views[0] if views else None)
    if not rep:
        return "", ""
    return rep.get("ldisplayCategoryName") or "", rep.get("mdisplayCategoryName") or ""


def exclusion_reason(raw: dict) -> str | None:
    """내 기준에 걸리면 사유 문자열, 통과하면 None."""
    title = (raw.get("campaignTitle") or "").lower()
    brand = ((raw.get("brand") or {}).get("name") or "").lower()
    text = f"{title} {brand}"

    if any(k in text for k in PET_KEYWORDS):
        return None  # 반려동물 용품은 카테고리와 무관하게 포함

    lcat, mcat = _category(raw)
    if lcat in EXCLUDE_LDISPLAY:
        return f"카테고리:{lcat}"
    if (lcat, mcat) in EXCLUDE_SUBCATEGORY:
        return f"카테고리:{mcat}"
    if any(k in text for k in KIDS_KEYWORDS):
        return "키워드:유아/임산부"
    if any(k in text for k in FEMALE_KEYWORDS) and not any(k in text for k in UNISEX_KEYWORDS):
        return "키워드:여성전용"
    return None


def to_record(raw: dict, today) -> dict:
    cid = raw["campaignId"]
    recruit = int(raw.get("recruitmentCount") or 0)
    applied = int(raw.get("applicationCount") or 0)
    remaining = int(raw.get("remainingDays") or 0)
    lcat, mcat = _category(raw)
    win_rate = min(100.0, recruit / max(applied, 1) * 100)
    return {
        "campaignId": cid,
        "title": (raw.get("campaignTitle") or "").strip(),
        "brandName": (raw.get("brand") or {}).get("name") or "",
        "imageUrl": raw.get("imageUrl") or "",
        "recruitmentCount": recruit,
        "applicationCount": applied,
        "winRate": round(win_rate, 2),
        "endDate": (today + timedelta(days=remaining)).isoformat(),
        "isNew": remaining >= NEW_MIN_REMAINING_DAYS,
        "mobileUrl": mobile_url(cid),
        "remainingDays": remaining,
        "category": " · ".join(x for x in (lcat, mcat) if x),
        "productId": raw.get("productId"),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "data", "campaigns.json"))
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--show-excluded", action="store_true")
    args = ap.parse_args()

    now = datetime.now(KST)
    today = now.date()

    raw_items = fetch_all()
    if not raw_items:
        print("수집된 캠페인이 없습니다.", file=sys.stderr)
        return 1

    kept: list[dict] = []
    dropped: list[tuple[dict, str]] = []
    for raw in raw_items:
        reason = exclusion_reason(raw)
        if reason:
            dropped.append((raw, reason))
        else:
            kept.append(to_record(raw, today))

    kept.sort(key=lambda c: (-c["remainingDays"], -c["winRate"]))
    new_count = sum(1 for c in kept if c["isNew"])

    payload = {
        "updatedAt": now.isoformat(timespec="seconds"),
        "source": API_URL,
        "rawTotalCount": len(raw_items),
        "excludedCount": len(dropped),
        "totalCount": len(kept),
        "newCount": new_count,
        "newRule": f"마감 {NEW_MIN_REMAINING_DAYS}일 이상 남은 최신 등록분(모집 7일 기준)",
        "campaigns": kept,
    }

    print(f"수집 {len(raw_items)}건 → 필터 후 {len(kept)}건 (신규 {new_count}건)")
    top = kept[:3]
    for i, c in enumerate(top, 1):
        print(f"  {i}. [{c['winRate']}%] 모집{c['recruitmentCount']}/신청{c['applicationCount']} "
              f"D-{c['remainingDays']} {c['title'][:40]}")
    if args.show_excluded:
        print("\n제외 목록:")
        for raw, reason in dropped:
            print(f"  - {reason} | {(raw.get('campaignTitle') or '')[:60]}")

    if args.dry_run:
        print("(dry-run: 파일을 쓰지 않았습니다)")
        return 0

    out_path = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fp:
        json.dump(payload, fp, ensure_ascii=False, indent=2)
        fp.write("\n")
    print(f"저장: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
