#!/usr/bin/env python3
"""kakao-trial-feed 발표일·신청완료 스냅샷 검증 러너 (QuickJS).

app.js 의 순수 함수(KT)와 실제 data/campaigns.json 을 그대로 불러 tests/announce.test.js 를 돌린다.
발표일 계산(마감 다음 날 11시), 오늘 발표 배지, 발표 당일 유지, 발표 다음 날 자동 정리,
예전 체크분 보강(hydrate), 목록에서 빠진 신청완료 카드 복원을 확인한다.
"""
import json
import pathlib
import sys

import quickjs

ROOT = pathlib.Path(__file__).resolve().parent.parent


def main() -> int:
    app = (ROOT / "app.js").read_text(encoding="utf-8")
    data = (ROOT / "data" / "campaigns.json").read_text(encoding="utf-8")
    test = (ROOT / "tests" / "announce.test.js").read_text(encoding="utf-8")

    ctx = quickjs.Context()
    ctx.eval("globalThis.__DATA__ = " + data + ";")
    ctx.eval(app)
    if not ctx.eval("typeof globalThis.KT === 'object'"):
        print("KT 를 찾지 못했습니다 (app.js 로드 실패)")
        return 2
    ctx.eval(test)
    result = json.loads(ctx.eval("JSON.stringify(globalThis.__RESULT__)"))

    for line in result["log"]:
        print(line)
    print(f"\n결과: {result['pass']} 통과 / {result['fail']} 실패")
    return 0 if result["fail"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
