"""
NotebookLM 逐轮提问模块

功能：
1. 从 question_rounds.json 加载问题清单
2. 按顺序逐轮向 NotebookLM 提问
3. 保存每轮答案到 data/answers/{project_id}/
4. 支持失败重跑单轮
5. 保存 answers_manifest.json 索引文件
"""
import asyncio
import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ── 常量 ──────────────────────────────────────────────────────────────
TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"
ANSWERS_DIR = Path(__file__).resolve().parent.parent / "data" / "answers"


def load_question_rounds() -> list[dict]:
    """加载问题清单"""
    path = TEMPLATES_DIR / "question_rounds.json"
    if not path.exists():
        raise FileNotFoundError(f"问题模板文件不存在: {path}")
    with open(path, "r", encoding="utf-8") as f:
        rounds = json.load(f)
    return [r for r in rounds if r.get("enabled", True)]


def get_answers_dir(project_id: str) -> Path:
    """获取项目答案目录"""
    d = ANSWERS_DIR / project_id
    d.mkdir(parents=True, exist_ok=True)
    return d


async def ask_question(
    notebook_id: str,
    question: str,
    source_ids: list[str] | None = None,
) -> dict[str, Any]:
    """
    向 NotebookLM 提问单轮问题。

    Returns:
        {status, answer, conversation_id, error_message}
    """
    from notebooklm import NotebookLMClient

    async with NotebookLMClient.from_storage() as client:
        try:
            result = await client.chat.ask(
                notebook_id=notebook_id,
                question=question,
                source_ids=source_ids,
            )
            return {
                "status": "success",
                "answer": result.answer,
                "conversation_id": result.conversation_id,
                "error_message": "",
                "raw_answer": result.answer,
            }
        except Exception as e:
            logger.error(f"提问失败: {e}")
            return {
                "status": "failed",
                "answer": "",
                "conversation_id": "",
                "error_message": str(e),
            }


async def run_all_questions(
    notebook_id: str,
    project_id: str,
    manifest_records: list[dict] | None = None,
    skip_questions: bool = False,
) -> dict[str, Any]:
    """
    按问题清单逐轮提问，保存答案。

    Args:
        notebook_id: NotebookLM 笔记 ID
        project_id: 项目 ID
        manifest_records: manifest 记录（用于提取 source_ids）
        skip_questions: 跳过提问

    Returns:
        {status, rounds_total, rounds_success, rounds_failed, answers_dir, ...}
    """
    if skip_questions:
        return {
            "status": "skipped",
            "rounds_total": 0,
            "rounds_success": 0,
            "rounds_failed": 0,
            "answers_dir": str(get_answers_dir(project_id)),
        }

    rounds = load_question_rounds()
    answers_dir = get_answers_dir(project_id)
    logger.info(f"开始逐轮提问，共 {len(rounds)} 轮，答案目录: {answers_dir}")

    # 获取已上传的 source_ids（用于限定提问范围）
    source_ids = None
    if manifest_records:
        ids = [
            r.get("source_id")
            for r in manifest_records
            if r.get("upload_status") == "uploaded" and r.get("source_id")
        ]
        if ids:
            source_ids = ids

    results: list[dict[str, Any]] = []
    rounds_success = 0
    rounds_failed = 0

    for round_data in rounds:
        round_id = round_data["round_id"]
        round_no = round_data["round_no"]
        round_name = round_data["round_name"]
        prompt = round_data["prompt"]

        logger.info(f"  [{round_no}/{len(rounds)-1}] {round_name}...")

        # 检查是否已有答案（断点续跑）
        answer_path = answers_dir / f"{round_id}.md"
        if answer_path.exists():
            logger.info(f"    已有答案文件，跳过: {answer_path}")
            existing_answer = answer_path.read_text(encoding="utf-8")
            results.append({
                "round_id": round_id,
                "round_no": round_no,
                "round_name": round_name,
                "status": "skipped",
                "answer_file": str(answer_path),
                "error_message": "",
            })
            if existing_answer.strip():
                rounds_success += 1
            continue

        # 提问
        answer = await ask_question(
            notebook_id=notebook_id,
            question=prompt,
            source_ids=source_ids,
        )

        if answer["status"] == "success":
            # 保存答案
            answer_text = answer.get("answer", "")
            answer_path.write_text(answer_text, encoding="utf-8")
            logger.info(f"    答案已保存: {answer_path}")
            rounds_success += 1
            results.append({
                "round_id": round_id,
                "round_no": round_no,
                "round_name": round_name,
                "status": "success",
                "answer_file": str(answer_path),
                "error_message": "",
            })
        else:
            logger.warning(f"    提问失败: {answer.get('error_message', '')}")
            rounds_failed += 1
            results.append({
                "round_id": round_id,
                "round_no": round_no,
                "round_name": round_name,
                "status": "failed",
                "answer_file": "",
                "error_message": answer.get("error_message", ""),
            })

        # 轮间间隔
        await asyncio.sleep(2.0)

    # 保存 answers_manifest
    answers_manifest = {
        "project_id": project_id,
        "notebook_id": notebook_id,
        "total_rounds": len(rounds),
        "success_rounds": rounds_success,
        "failed_rounds": rounds_failed,
        "answers_dir": str(answers_dir),
        "results": results,
        "updated_at": datetime.now().isoformat(),
    }
    manifest_path = answers_dir / "answers_manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(answers_manifest, f, ensure_ascii=False, indent=2)
    logger.info(f"答案索引已保存: {manifest_path}")

    total_rounds = len(rounds)
    return {
        "status": "completed" if rounds_failed == 0 else "partial",
        "rounds_total": total_rounds,
        "rounds_success": rounds_success,
        "rounds_failed": rounds_failed,
        "answers_dir": str(answers_dir),
        "answers_manifest_path": str(manifest_path),
    }


# ── 同步入口 ──────────────────────────────────────────────────────────


def run_questions(
    notebook_id: str,
    project_id: str,
    manifest_records: list[dict] | None = None,
    skip_questions: bool = False,
) -> dict[str, Any]:
    """同步执行的提问入口"""
    from notebooklm import NotebookLMClient

    # 先检查登录
    try:
        asyncio.run(check_auth())
    except Exception as e:
        return {
            "status": "auth_failed",
            "error_message": f"NotebookLM 登录检查失败: {e}",
            "rounds_total": 0,
            "rounds_success": 0,
            "rounds_failed": 0,
        }

    return asyncio.run(
        run_all_questions(
            notebook_id=notebook_id,
            project_id=project_id,
            manifest_records=manifest_records,
            skip_questions=skip_questions,
        )
    )


async def check_auth() -> bool:
    """检查 NotebookLM 登录状态"""
    from notebooklm import NotebookLMClient

    async with NotebookLMClient.from_storage() as client:
        notebooks = await client.notebooks.list()
        logger.info(f"NotebookLM 登录正常，可访问 {len(notebooks)} 个笔记")
        return True
