#!/usr/bin/env python3
"""kakao-trial-feed 카드 숨김 UI 흐름 스모크 테스트 러너 (QuickJS + 최소 가짜 DOM).

app.js 를 그대로 불러 가짜 DOM 위에서 화면 블록을 실행하고, 숨기기 클릭 →
건수·칩 감소 → 토스트 되돌리기 → 하단 '모두 되돌리기' → 재로드 유지를 확인한다.
"""
import json
import pathlib
import sys

import quickjs

ROOT = pathlib.Path(__file__).resolve().parent.parent


def main() -> int:
    app = (ROOT / "app.js").read_text(encoding="utf-8")
    data = (ROOT / "data" / "campaigns.json").read_text(encoding="utf-8")
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    smoke = (ROOT / "tests" / "ui.smoke.js").read_text(encoding="utf-8")

    ctx = quickjs.Context()
    ctx.eval("globalThis.__DATA__ = " + data + ";")
    ctx.eval("globalThis.__HTML__ = " + json.dumps(html) + ";")
    ctx.eval("globalThis.__APP_SRC__ = " + json.dumps(app) + ";")
    ctx.eval("globalThis.__RERUN__ = function () { (0, eval)(__APP_SRC__); };")
    ctx.eval(app)
    ctx.eval(smoke)
    result = json.loads(ctx.eval("JSON.stringify(globalThis.__RESULT__)"))

    for line in result["log"]:
        print(line)
    print(f"\n결과: {result['pass']} 통과 / {result['fail']} 실패")
    return 0 if result["fail"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
