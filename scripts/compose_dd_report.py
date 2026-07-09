"""
报告拼接模块

功能：
1. 读取每轮答案文件
2. 按 dd_report_outline.md 模板框架拼接 Markdown 报告
3. 公告无法填列的内容保留占位符
4. 在报告末尾追加附录（公告引用、未能填列事项、提问记录）
"""
import json
import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ── 占位符 ─────────────────────────────────────────────────────────────
PLACEHOLDERS = {
    "unfilled": "[公告资料未披露]",
    "need_verify": "[仅凭公告资料无法核实，需补充尽调资料]",
    "need_inspection": "[需现场核查]",
    "need_supplement": "[需企业提供补充材料]",
}

TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"
REPORTS_DIR = Path(__file__).resolve().parent.parent / "data" / "reports"


def load_answers(project_id: str) -> dict[str, str]:
    """加载项目所有答案文件，优先按 answers_manifest 中的 round_id 映射。"""
    answers_dir = Path(__file__).resolve().parent.parent / "data" / "answers" / project_id
    answers: dict[str, str] = {}
    if not answers_dir.exists():
        logger.warning(f"答案目录不存在: {answers_dir}")
        return answers

    manifest = load_answers_manifest(project_id)
    results = manifest.get("results", []) if isinstance(manifest, dict) else []
    for item in results:
        if not isinstance(item, dict):
            continue
        round_id = item.get("round_id")
        answer_file = item.get("answer_file")
        if not round_id or not answer_file:
            continue
        path = Path(str(answer_file))
        if not path.exists():
            continue
        content = path.read_text(encoding="utf-8")
        answers[str(round_id)] = content if content.strip() else f"\n\n{PLACEHOLDERS['unfilled']}\n\n"
        logger.debug(f"  已加载: {path.name} ({len(content)} chars)")

    for f in sorted(answers_dir.glob("*.md")):
        if f.stem in answers:
            continue
        content = f.read_text(encoding="utf-8")
        answers[f.stem] = content if content.strip() else f"\n\n{PLACEHOLDERS['unfilled']}\n\n"

    return answers


def load_question_rounds() -> list[dict]:
    """加载问题清单（获取轮次名称信息）"""
    path = TEMPLATES_DIR / "question_rounds.json"
    if not path.exists():
        return []
    with open(path, "r", encoding="utf-8") as f:
        rounds = json.load(f)
    return rounds


def load_answers_manifest(project_id: str) -> dict:
    """加载 answers_manifest.json"""
    path = (
        Path(__file__).resolve().parent.parent
        / "data" / "answers" / project_id / "answers_manifest.json"
    )
    if not path.exists():
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def render_outline(
    outline_text: str,
    answers: dict[str, str],
    project_name: str = "",
    stock_code: str = "",
    stock_name: str = "",
    question_rounds: list[dict] | None = None,
) -> str:
    """
    将答案填充到报告大纲模板中。
    使用 {{round_N_answer}} 格式的占位符替换。
    """
    # 基础变量替换
    report_date = datetime.now().strftime("%Y-%m-%d")
    replacements = {
        "{{project_name}}": project_name,
        "{{stock_code}}": stock_code,
        "{{stock_name}}": stock_name,
        "{{report_date}}": report_date,
    }
    for key, value in replacements.items():
        outline_text = outline_text.replace(key, value)

    # 替换轮次答案占位符
    rendered_round_ids: set[str] = set()
    for round_id, answer_text in answers.items():
        placeholder = f"{{{{{round_id}_answer}}}}"
        if placeholder in outline_text:
            outline_text = outline_text.replace(placeholder, answer_text.strip())
            rendered_round_ids.add(round_id)

    # 填充未替换的占位符（没有对应答案的轮次）
    pattern = re.compile(r'\{\{(?:round_\d+|q-custom-[\w-]+)_answer\}\}')
    outline_text = pattern.sub(f"\n\n{PLACEHOLDERS['unfilled']}\n\n", outline_text)

    # 填充其他模板变量
    for key, placeholder in PLACEHOLDERS.items():
        outline_text = outline_text.replace(f"{{{{{key}}}}}", placeholder)

    extra_sections: list[str] = []
    for round_data in question_rounds or []:
        round_id = str(round_data.get("round_id", ""))
        if not round_id or round_id in rendered_round_ids or round_id not in answers:
            continue
        title = str(round_data.get("round_name", round_id))
        extra_sections.append(f"\n\n---\n\n## 补充问题：{title}\n\n{answers[round_id].strip()}")

    if extra_sections:
        outline_text += "\n\n---\n\n# 补充问题分析" + "".join(extra_sections)

    return outline_text


def compose_report(
    project_id: str,
    project_name: str = "",
    stock_code: str = "",
    stock_name: str = "",
    skip_report: bool = False,
) -> dict[str, Any]:
    """
    拼接尽调报告。

    Returns:
        {status, report_path, ...}
    """
    if skip_report:
        return {"status": "skipped", "report_path": ""}

    # 1. 读取模板
    outline_path = TEMPLATES_DIR / "dd_report_outline.md"
    if not outline_path.exists():
        raise FileNotFoundError(f"报告模板不存在: {outline_path}")
    outline_text = outline_path.read_text(encoding="utf-8")

    # 2. 加载答案
    answers = load_answers(project_id)

    if not answers:
        logger.warning(f"没有找到答案文件，报告将包含全部占位符")

    # 4. 填充报告大纲
    question_rounds = load_question_rounds()
    report_body = render_outline(
        outline_text=outline_text,
        answers=answers,
        project_name=project_name,
        stock_code=stock_code,
        stock_name=stock_name,
        question_rounds=question_rounds,
    )

    # 5. 拼接完整报告。业务报告不再追加公告清单、提问记录等附录。
    full_report = report_body

    # 7. 写入文件
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    report_path = REPORTS_DIR / f"{project_id}_dd_report.md"
    report_path.write_text(full_report, encoding="utf-8")
    logger.info(f"报告已生成: {report_path} ({len(full_report)} chars)")

    # 8. 统计
    unfilled_count = full_report.count(PLACEHOLDERS["unfilled"])
    need_verify_count = full_report.count(PLACEHOLDERS["need_verify"])

    # 统计各轮次状态
    question_rounds = load_question_rounds()
    total_rounds = len(question_rounds)
    answer_count = len(answers)

    return {
        "status": "completed",
        "report_path": str(report_path),
        "total_chars": len(full_report),
        "unfilled_count": unfilled_count,
        "need_verify_count": need_verify_count,
        "total_question_rounds": total_rounds,
        "answered_rounds": answer_count,
        "unanswered_rounds": total_rounds - answer_count,
    }
