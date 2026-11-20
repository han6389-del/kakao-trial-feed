#!/usr/bin/env python3
"""index.html + styles.css + app.js + data/campaigns.json 을 하나의 HTML 파일로 묶는다.

호스팅 없이 폰에서 바로 열어 볼 수 있는 배포본(단일 파일)을 만든다.
데이터는 `window.__DATA__` 로 심고, 앱은 campaigns.json 요청이 실패하면 그 값을 쓴다.

사용:
    python3 scripts/build_standalone.py                     # dist/카카오-체험단-피드.html
    python3 scripts/build_standalone.py --out /경로/파일.html
"""

from __future__ import annotations

import argparse
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(rel: str) -> str:
    with open(os.path.join(ROOT, rel), encoding="utf-8") as fp:
        return fp.read()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "dist", "카카오-체험단-피드.html"))
    args = ap.parse_args()

    html = read("index.html")
    css = read("styles.css")
    js = read("app.js")
    data = json.loads(read(os.path.join("data", "campaigns.json")))

    # 헤드: 외부 CSS/매니페스트/아이콘 참조 제거하고 스타일 인라인
    for line in (
        '<link rel="manifest" href="manifest.json">\n',
        '<link rel="icon" href="icons/icon.svg" type="image/svg+xml">\n',
        '<link rel="apple-touch-icon" href="icons/icon-192.png">\n',
        '<link rel="stylesheet" href="styles.css">\n',
    ):
        html = html.replace(line, "")
    html = html.replace("</head>", f"<style>\n{css}\n</style>\n</head>")

    # 본문 끝: 데이터 + 앱 스크립트 인라인
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    inline = (
        f"<script>window.__DATA__={payload};</script>\n"
        f"<script>\n{js}\n</script>\n"
    )
    html = html.replace('<script src="app.js" defer></script>\n', "").replace("</body>", inline + "</body>")

    out = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as fp:
        fp.write(html)
    size = os.path.getsize(out) / 1024
    print(f"저장: {out} ({size:.0f} KB, {len(data['campaigns'])}건)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
