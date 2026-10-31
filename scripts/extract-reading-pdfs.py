#!/usr/bin/env python3
"""从英语二试卷 PDF 抽取全文（一次性作者工具，不参与应用构建）。

数据源目录默认取环境变量 READING_SOURCE_DIR，或本机已下载的真题目录。
产物：reading-source/pdf-text/*.txt，每页以 === PAGE n === 标记，便于回填 sourceRef。

用法：
  python3 scripts/extract-reading-pdfs.py \
    --source "/Users/cgy/data/work-buddy/考研英语二真题" \
    --out reading-source/pdf-text
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from pypdf import PdfReader

DEFAULT_SOURCE = os.environ.get(
    "READING_SOURCE_DIR", "/Users/cgy/data/work-buddy/考研英语二真题"
)


def main() -> int:
    parser = argparse.ArgumentParser(description="抽取英语二试卷 PDF 文本")
    parser.add_argument("--source", default=DEFAULT_SOURCE, help="真题数据目录")
    parser.add_argument("--out", default="reading-source/pdf-text", help="输出目录")
    args = parser.parse_args()

    source_dir = Path(args.source) / "原件存档"
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    pdfs = sorted(source_dir.glob("*.pdf"))
    if not pdfs:
        print(f"未找到 PDF：{source_dir}", file=sys.stderr)
        return 1

    for pdf in pdfs:
        reader = PdfReader(str(pdf))
        chunks: list[str] = []
        for index, page in enumerate(reader.pages, 1):
            chunks.append(f"\n=== PAGE {index} ===\n")
            # layout 模式保留段落缩进与空行，便于切分阅读文章段落
            try:
                text = page.extract_text(extraction_mode="layout") or ""
            except Exception:
                text = page.extract_text() or ""
            chunks.append(text)
        target = out_dir / f"{pdf.stem}.txt"
        target.write_text("".join(chunks), encoding="utf-8")
        print(f"{pdf.name}: {len(reader.pages)} 页 -> {target}")

    print(f"完成：{len(pdfs)} 份 PDF")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
