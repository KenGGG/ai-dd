"""
列出指定 NotebookLM 笔记中的 sources，用于前端展示存量笔记附件。
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="列出 NotebookLM 笔记 sources")
    parser.add_argument("--notebook-id", required=True)
    return parser.parse_args()


async def list_sources(notebook_id: str) -> dict:
    from notebooklm import NotebookLMClient

    async with NotebookLMClient.from_storage() as client:
        sources = await client.sources.list(notebook_id)
        return {
            "status": "ok",
            "notebook_id": notebook_id,
            "sources": [
                {
                    "source_id": getattr(source, "id", "") or "",
                    "title": getattr(source, "title", "") or "",
                    "kind": str(getattr(source, "kind", "") or ""),
                    "status": str(getattr(source, "status", "") or ""),
                    "is_ready": bool(getattr(source, "is_ready", False)),
                }
                for source in sources
            ],
        }


def main() -> None:
    args = parse_args()
    try:
        print(json.dumps(asyncio.run(list_sources(args.notebook_id)), ensure_ascii=False))
    except Exception as exc:
        print(
            json.dumps(
                {
                    "status": "failed",
                    "notebook_id": args.notebook_id,
                    "sources": [],
                    "error_message": str(exc),
                },
                ensure_ascii=False,
            )
        )
        raise


if __name__ == "__main__":
    main()
