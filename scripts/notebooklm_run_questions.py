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
REPORT_PROMPT_PREFIX = "请根据当前的资料，特别是2025、2026年近期这些报告，回答以下问题："


def load_question_rounds() -> list[dict]:
    """加载问题清单"""
    path = TEMPLATES_DIR / "question_rounds.json"
    if not path.exists():
        raise FileNotFoundError(f"问题模板文件不存在: {path}")
    with open(path, "r", encoding="utf-8") as f:
        rounds = json.load(f)
    return [r for r in rounds if r.get("enabled", True)]


def select_question_rounds(round_ids: list[str] | None = None) -> list[dict]:
    rounds = load_question_rounds()
    if not round_ids:
        return rounds
    wanted = set(round_ids)
    return [round_data for round_data in rounds if round_data.get("round_id") in wanted]


def get_answers_dir(project_id: str) -> Path:
    """获取项目答案目录"""
    d = ANSWERS_DIR / project_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def write_answers_manifest(
    answers_dir: Path,
    project_id: str,
    notebook_id: str,
    rounds: list[dict],
    results: list[dict[str, Any]],
) -> Path:
    """写入当前提问进度，供前端轮询展示。"""
    by_round_id = {result.get("round_id"): result for result in results}
    normalized_results: list[dict[str, Any]] = []

    for round_data in rounds:
        round_id = round_data["round_id"]
        current = by_round_id.get(round_id)
        if current:
            normalized_results.append(current)
        else:
            normalized_results.append({
                "round_id": round_id,
                "round_no": round_data["round_no"],
                "round_name": round_data["round_name"],
                "prompt": round_data.get("prompt", ""),
                "question_method": round_data.get("question_method", "chat"),
                "artifact_id": "",
                "task_id": "",
                "status": "pending",
                "answer_file": "",
                "error_message": "",
            })

    success_statuses = {"success", "skipped"}
    answers_manifest = {
        "project_id": project_id,
        "notebook_id": notebook_id,
        "total_rounds": len(rounds),
        "success_rounds": sum(1 for item in normalized_results if item.get("status") in success_statuses),
        "failed_rounds": sum(1 for item in normalized_results if item.get("status") == "failed"),
        "running_rounds": sum(1 for item in normalized_results if item.get("status") in {"running", "submitted"}),
        "pending_rounds": sum(1 for item in normalized_results if item.get("status") == "pending"),
        "answers_dir": str(answers_dir),
        "results": normalized_results,
        "updated_at": datetime.now().isoformat(),
    }
    manifest_path = answers_dir / "answers_manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(answers_manifest, f, ensure_ascii=False, indent=2)
    return manifest_path


def read_answers_manifest(answers_dir: Path) -> dict[str, Any]:
    """读取既有答案索引，用于判断问题模板是否发生变化。"""
    manifest_path = answers_dir / "answers_manifest.json"
    if not manifest_path.exists():
        return {}
    try:
        with open(manifest_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception as e:
        logger.warning(f"读取旧答案索引失败，将重新生成: {e}")
        return {}


def normalize_prompt(prompt: str | None) -> str:
    return (prompt or "").strip()


async def ask_question(
    notebook_id: str,
    question: str,
    source_ids: list[str] | None = None,
    skip_conversation_lookup: bool = True,
) -> dict[str, Any]:
    """
    向 NotebookLM 提问单轮问题。

    Returns:
        {status, answer, conversation_id, error_message}
    """
    from notebooklm import NotebookLMClient

    async with NotebookLMClient.from_storage(chat_timeout=240.0) as client:
        try:
            if skip_conversation_lookup:
                async def _local_conversation_id(_notebook_id: str) -> str:
                    return f"aidda-local-{notebook_id}"

                client.chat.get_conversation_id = _local_conversation_id

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


def build_report_prompt(prompt: str, prefix: str = REPORT_PROMPT_PREFIX) -> str:
    normalized = normalize_prompt(prompt)
    if normalized.startswith(prefix):
        return normalized
    return f"{prefix}{normalized}"


async def generate_report_question(
    client: Any,
    notebook_id: str,
    question: str,
    source_ids: list[str] | None = None,
    prompt_prefix: str = REPORT_PROMPT_PREFIX,
) -> dict[str, Any]:
    """Start a NotebookLM custom report generation task for one question."""
    from notebooklm.rpc.types import ReportFormat

    prompt = build_report_prompt(question, prompt_prefix)
    try:
        status = await client.artifacts.generate_report(
            notebook_id=notebook_id,
            report_format=ReportFormat.CUSTOM,
            source_ids=source_ids,
            language="zh",
            custom_prompt=prompt,
        )
        task_id = getattr(status, "task_id", "") or ""
        return {
            "status": "submitted" if task_id else "failed",
            "task_id": task_id,
            "artifact_id": task_id,
            "error_message": "" if task_id else "NotebookLM 未返回 report task_id",
        }
    except Exception as e:
        logger.error(f"报告生成提交失败: {e}")
        return {
            "status": "failed",
            "task_id": "",
            "artifact_id": "",
            "error_message": str(e),
        }


async def wait_and_download_report_question(
    client: Any,
    notebook_id: str,
    artifact_id: str,
    answer_path: Path,
    timeout: float = 900.0,
) -> dict[str, Any]:
    """Wait for a generated report artifact and download it as markdown."""
    try:
        final = await client.artifacts.wait_for_completion(
            notebook_id,
            artifact_id,
            timeout=timeout,
        )
        final_status = getattr(final, "status", "")
        if final_status != "completed":
            error = getattr(final, "error", "") or f"NotebookLM report 状态为 {final_status}"
            return {"status": "failed", "answer": "", "error_message": error}

        downloaded = await client.artifacts.download_report(
            notebook_id,
            str(answer_path),
            artifact_id=artifact_id,
        )
        text = Path(downloaded).read_text(encoding="utf-8")
        return {"status": "success", "answer": text, "error_message": ""}
    except Exception as e:
        logger.error(f"报告生成等待或下载失败: {e}")
        return {"status": "failed", "answer": "", "error_message": str(e)}


async def run_all_questions(
    notebook_id: str,
    project_id: str,
    manifest_records: list[dict] | None = None,
    skip_questions: bool = False,
    max_rounds: int | None = None,
    max_source_ids: int | None = None,
    round_ids: list[str] | None = None,
    force: bool = False,
    question_method: str = "chat",
    report_prompt_prefix: str = REPORT_PROMPT_PREFIX,
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

    all_rounds = load_question_rounds()
    rounds = select_question_rounds(round_ids)
    if max_rounds and max_rounds > 0:
        rounds = rounds[:max_rounds]
    answers_dir = get_answers_dir(project_id)
    old_manifest = read_answers_manifest(answers_dir)
    old_results = old_manifest.get("results", [])
    previous_by_round_id = {
        item.get("round_id"): item
        for item in old_results
        if isinstance(item, dict) and item.get("round_id")
    }
    logger.info(f"开始逐轮提问，共 {len(rounds)} 轮，答案目录: {answers_dir}")

    # 获取已上传的 source_ids（用于限定提问范围）
    source_ids = None
    if manifest_records:
        ids = [
            r.get("source_id")
            for r in manifest_records
            if r.get("upload_status") in {"uploaded", "skipped_existing_source"}
            and r.get("source_id")
        ]
        if ids:
            source_ids = ids
    if source_ids and max_source_ids and max_source_ids > 0:
        source_ids = source_ids[:max_source_ids]
        logger.info(f"测试模式：本轮仅限定前 {len(source_ids)} 个 NotebookLM source")

    method = "report" if question_method == "report" else "chat"
    selected_ids = {round_data["round_id"] for round_data in rounds}
    results: list[dict[str, Any]] = []
    for round_data in all_rounds:
        round_id = round_data["round_id"]
        if round_id in selected_ids:
            continue
        answer_path = answers_dir / f"{round_id}.md"
        if answer_path.exists() and answer_path.read_text(encoding="utf-8").strip():
            results.append({
                "round_id": round_id,
                "round_no": round_data["round_no"],
                "round_name": round_data["round_name"],
                "prompt": round_data.get("prompt", ""),
                "question_method": previous_by_round_id.get(round_id, {}).get("question_method", method),
                "artifact_id": previous_by_round_id.get(round_id, {}).get("artifact_id", ""),
                "task_id": previous_by_round_id.get(round_id, {}).get("task_id", ""),
                "status": "success",
                "answer_file": str(answer_path),
                "error_message": "",
            })
    rounds_success = 0
    rounds_failed = 0
    manifest_path = write_answers_manifest(answers_dir, project_id, notebook_id, all_rounds, results)

    if method == "report":
        return await run_report_questions(
            notebook_id=notebook_id,
            project_id=project_id,
            all_rounds=all_rounds,
            rounds=rounds,
            answers_dir=answers_dir,
            results=results,
            previous_by_round_id=previous_by_round_id,
            source_ids=source_ids,
            force=force,
            prompt_prefix=report_prompt_prefix,
        )

    for round_data in rounds:
        round_id = round_data["round_id"]
        round_no = round_data["round_no"]
        round_name = round_data["round_name"]
        prompt = round_data["prompt"]

        logger.info(f"  [{round_no}/{len(rounds)-1}] {round_name}...")

        # 检查是否已有答案（断点续跑）；问题模板变化时必须重新提问。
        answer_path = answers_dir / f"{round_id}.md"
        previous_result = previous_by_round_id.get(round_id, {})
        prompt_is_unchanged = (
            normalize_prompt(previous_result.get("prompt")) == normalize_prompt(prompt)
        )
        if force and answer_path.exists():
            answer_path.unlink()
            logger.info(f"    已删除旧答案，准备重新提问: {answer_path}")
        elif answer_path.exists() and not prompt_is_unchanged:
            answer_path.unlink()
            logger.info(f"    检测到问题模板已变更，删除旧答案并重新提问: {answer_path}")

        if answer_path.exists():
            logger.info(f"    已有答案文件，跳过: {answer_path}")
            existing_answer = answer_path.read_text(encoding="utf-8")
            results.append({
                "round_id": round_id,
                "round_no": round_no,
                "round_name": round_name,
                "prompt": prompt,
                "question_method": method,
                "artifact_id": previous_result.get("artifact_id", ""),
                "task_id": previous_result.get("task_id", ""),
                "status": "skipped",
                "answer_file": str(answer_path),
                "error_message": "",
            })
            if existing_answer.strip():
                rounds_success += 1
            manifest_path = write_answers_manifest(answers_dir, project_id, notebook_id, all_rounds, results)
            continue

        results.append({
            "round_id": round_id,
            "round_no": round_no,
            "round_name": round_name,
            "prompt": prompt,
            "question_method": method,
            "artifact_id": "",
            "task_id": "",
            "status": "running",
            "answer_file": "",
            "error_message": "",
        })
        manifest_path = write_answers_manifest(answers_dir, project_id, notebook_id, all_rounds, results)

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
            results[-1] = {
                "round_id": round_id,
                "round_no": round_no,
                "round_name": round_name,
                "prompt": prompt,
                "question_method": method,
                "artifact_id": "",
                "task_id": "",
                "status": "success",
                "answer_file": str(answer_path),
                "error_message": "",
            }
        else:
            logger.warning(f"    提问失败: {answer.get('error_message', '')}")
            rounds_failed += 1
            results[-1] = {
                "round_id": round_id,
                "round_no": round_no,
                "round_name": round_name,
                "prompt": prompt,
                "question_method": method,
                "artifact_id": "",
                "task_id": "",
                "status": "failed",
                "answer_file": "",
                "error_message": answer.get("error_message", ""),
            }

        manifest_path = write_answers_manifest(answers_dir, project_id, notebook_id, all_rounds, results)

        # 轮间间隔
        await asyncio.sleep(2.0)

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


async def run_report_questions(
    notebook_id: str,
    project_id: str,
    all_rounds: list[dict],
    rounds: list[dict],
    answers_dir: Path,
    results: list[dict[str, Any]],
    previous_by_round_id: dict[str, dict],
    source_ids: list[str] | None,
    force: bool,
    prompt_prefix: str,
) -> dict[str, Any]:
    """Submit report-generation questions quickly, then wait for the artifacts."""
    from notebooklm import NotebookLMClient

    logger.info(f"开始报告生成式问答，共 {len(rounds)} 轮，答案目录: {answers_dir}")

    rounds_success = 0
    rounds_failed = 0
    pending_downloads: list[dict[str, Any]] = []
    manifest_path = write_answers_manifest(answers_dir, project_id, notebook_id, all_rounds, results)

    async with NotebookLMClient.from_storage() as client:
        for round_data in rounds:
            round_id = round_data["round_id"]
            round_no = round_data["round_no"]
            round_name = round_data["round_name"]
            prompt = round_data["prompt"]
            answer_path = answers_dir / f"{round_id}.md"
            previous_result = previous_by_round_id.get(round_id, {})
            previous_method = previous_result.get("question_method", "chat")
            prompt_is_unchanged = (
                normalize_prompt(previous_result.get("prompt")) == normalize_prompt(prompt)
            )
            reusable_report = (
                previous_method == "report"
                and prompt_is_unchanged
                and previous_result.get("artifact_id")
            )

            if force and answer_path.exists():
                answer_path.unlink()
                logger.info(f"    已删除旧答案，准备重新提交报告生成: {answer_path}")
            elif answer_path.exists() and (not prompt_is_unchanged or previous_method != "report"):
                answer_path.unlink()
                logger.info(f"    检测到问题模板或问答方式已变更，删除旧答案: {answer_path}")

            if answer_path.exists():
                logger.info(f"    已有报告答案文件，跳过: {answer_path}")
                results.append({
                    "round_id": round_id,
                    "round_no": round_no,
                    "round_name": round_name,
                    "prompt": prompt,
                    "question_method": "report",
                    "artifact_id": previous_result.get("artifact_id", ""),
                    "task_id": previous_result.get("task_id", ""),
                    "status": "skipped",
                    "answer_file": str(answer_path),
                    "error_message": "",
                })
                if answer_path.read_text(encoding="utf-8").strip():
                    rounds_success += 1
                manifest_path = write_answers_manifest(answers_dir, project_id, notebook_id, all_rounds, results)
                continue

            if reusable_report:
                artifact_id = str(previous_result.get("artifact_id") or previous_result.get("task_id"))
                logger.info(f"    复用已提交报告任务: {artifact_id}")
            else:
                logger.info(f"    快速提交报告生成: {round_name}")
                submitted = await generate_report_question(
                    client=client,
                    notebook_id=notebook_id,
                    question=prompt,
                    source_ids=source_ids,
                    prompt_prefix=prompt_prefix,
                )
                artifact_id = submitted.get("artifact_id", "")
                if submitted.get("status") == "failed":
                    rounds_failed += 1
                    results.append({
                        "round_id": round_id,
                        "round_no": round_no,
                        "round_name": round_name,
                        "prompt": prompt,
                        "question_method": "report",
                        "artifact_id": "",
                        "task_id": "",
                        "status": "failed",
                        "answer_file": "",
                        "error_message": submitted.get("error_message", ""),
                    })
                    manifest_path = write_answers_manifest(answers_dir, project_id, notebook_id, all_rounds, results)
                    continue

            results.append({
                "round_id": round_id,
                "round_no": round_no,
                "round_name": round_name,
                "prompt": prompt,
                "question_method": "report",
                "artifact_id": artifact_id,
                "task_id": artifact_id,
                "status": "submitted",
                "answer_file": "",
                "error_message": "",
            })
            pending_downloads.append({
                "round_id": round_id,
                "round_no": round_no,
                "round_name": round_name,
                "prompt": prompt,
                "artifact_id": artifact_id,
                "answer_path": answer_path,
            })
            manifest_path = write_answers_manifest(answers_dir, project_id, notebook_id, all_rounds, results)
            logger.info(f"    NotebookLM report task_id: {artifact_id}")

        for item in pending_downloads:
            round_id = item["round_id"]
            artifact_id = item["artifact_id"]
            logger.info(f"    等待并下载报告答案: {round_id} ({artifact_id})")
            for idx, result in enumerate(results):
                if result.get("round_id") == round_id:
                    results[idx] = {**result, "status": "running"}
                    break
            manifest_path = write_answers_manifest(answers_dir, project_id, notebook_id, all_rounds, results)

            downloaded = await wait_and_download_report_question(
                client=client,
                notebook_id=notebook_id,
                artifact_id=artifact_id,
                answer_path=item["answer_path"],
            )

            for idx, result in enumerate(results):
                if result.get("round_id") == round_id:
                    if downloaded["status"] == "success":
                        rounds_success += 1
                        results[idx] = {
                            **result,
                            "status": "success",
                            "answer_file": str(item["answer_path"]),
                            "error_message": "",
                        }
                    else:
                        rounds_failed += 1
                        results[idx] = {
                            **result,
                            "status": "failed",
                            "answer_file": "",
                            "error_message": downloaded.get("error_message", ""),
                        }
                    break
            manifest_path = write_answers_manifest(answers_dir, project_id, notebook_id, all_rounds, results)

    logger.info(f"答案索引已保存: {manifest_path}")
    return {
        "status": "completed" if rounds_failed == 0 else "partial",
        "rounds_total": len(rounds),
        "rounds_success": rounds_success,
        "rounds_failed": rounds_failed,
        "answers_dir": str(answers_dir),
        "answers_manifest_path": str(manifest_path),
        "question_method": "report",
    }


# ── 同步入口 ──────────────────────────────────────────────────────────


def run_questions(
    notebook_id: str,
    project_id: str,
    manifest_records: list[dict] | None = None,
    skip_questions: bool = False,
    max_rounds: int | None = None,
    max_source_ids: int | None = None,
    round_ids: list[str] | None = None,
    force: bool = False,
    question_method: str = "chat",
    report_prompt_prefix: str = REPORT_PROMPT_PREFIX,
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
            max_rounds=max_rounds,
            max_source_ids=max_source_ids,
            round_ids=round_ids,
            force=force,
            question_method=question_method,
            report_prompt_prefix=report_prompt_prefix,
        )
    )


async def check_auth() -> bool:
    """检查 NotebookLM 登录状态"""
    from notebooklm import NotebookLMClient

    async with NotebookLMClient.from_storage() as client:
        notebooks = await client.notebooks.list()
        logger.info(f"NotebookLM 登录正常，可访问 {len(notebooks)} 个笔记")
        return True
