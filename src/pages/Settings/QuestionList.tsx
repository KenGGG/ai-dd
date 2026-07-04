import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { SystemQuestion } from "../../types";

interface QuestionListProps {
  systemQuestions: SystemQuestion[];
  onDeleteQuestion: (questionId: string) => void;
  onUpdateQuestionInline: (questionId: string, field: keyof SystemQuestion, value: string) => void;
  onMoveQuestion: (index: number, direction: "up" | "down") => void;
}

export function QuestionList({
  systemQuestions,
  onDeleteQuestion,
  onUpdateQuestionInline,
  onMoveQuestion,
}: QuestionListProps) {
  return (
    <div className="lg:col-span-7 flex flex-col gap-4">
      <div className="px-4 py-1.5 bg-slate-200/50 border border-slate-200 rounded-xl flex items-center justify-between text-[10px] uppercase font-extrabold text-slate-500 tracking-wider">
        <span>当前启用的尽调提问流程与章节排布</span>
        <span className="font-mono">提问顺序决定汇编报告的章节排版</span>
      </div>

      <div className="space-y-4">
        {systemQuestions.map((question, index) => (
          <QuestionListItem
            key={question.id}
            question={question}
            index={index}
            isFirst={index === 0}
            isLast={index === systemQuestions.length - 1}
            onDeleteQuestion={onDeleteQuestion}
            onUpdateQuestionInline={onUpdateQuestionInline}
            onMoveQuestion={onMoveQuestion}
          />
        ))}
      </div>
    </div>
  );
}

interface QuestionListItemProps extends Omit<QuestionListProps, "systemQuestions"> {
  question: SystemQuestion;
  index: number;
  isFirst: boolean;
  isLast: boolean;
}

function QuestionListItem({
  question,
  index,
  isFirst,
  isLast,
  onDeleteQuestion,
  onUpdateQuestionInline,
  onMoveQuestion,
}: QuestionListItemProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 hover:border-slate-300 transition-all flex flex-col gap-3 group relative shadow-xs">
      <div className="flex justify-between items-start gap-4 pb-2 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-lg bg-blue-50 text-blue-600 text-xs font-black flex items-center justify-center border border-blue-100/60 shrink-0">
            {index + 1}
          </span>

          <input
            type="text"
            value={question.title}
            onChange={(event) => onUpdateQuestionInline(question.id, "title", event.target.value)}
            className="text-sm font-extrabold text-slate-800 bg-transparent border-b border-transparent hover:border-slate-200 focus:border-blue-500 focus:outline-none focus:bg-slate-50 px-1 py-0.5 rounded transition-all"
          />

          <span className="text-[9px] uppercase font-extrabold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded tracking-widest scale-90">
            {question.id.startsWith("q-custom") ? "自建提问" : "默认提问"}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onMoveQuestion(index, "up")}
            disabled={isFirst}
            className="p-1 rounded-lg hover:bg-slate-50 disabled:opacity-30 disabled:hover:bg-transparent text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
            title="排位前移"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onMoveQuestion(index, "down")}
            disabled={isLast}
            className="p-1 rounded-lg hover:bg-slate-50 disabled:opacity-30 disabled:hover:bg-transparent text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
            title="排位后移"
          >
            <ArrowDown className="h-4 w-4" />
          </button>
          <span className="text-slate-200">|</span>
          <button
            type="button"
            onClick={() => onDeleteQuestion(question.id)}
            className="p-1 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-500 transition-colors cursor-pointer"
            title="物理废弃"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="space-y-2.5 text-xs font-bold">
        <div className="space-y-1">
          <span className="text-[9px] uppercase font-extrabold text-slate-400 block tracking-wider">
            提问问题 / Prompt 具体描述 (支持实时修改)
          </span>
          <textarea
            value={question.prompt}
            onChange={(event) => onUpdateQuestionInline(question.id, "prompt", event.target.value)}
            rows={3}
            className="w-full bg-slate-50 border border-slate-100 hover:border-slate-200 focus:border-blue-500 focus:outline-none focus:bg-white text-slate-700 font-semibold text-xs rounded-lg p-3 transition-all resize-none leading-relaxed"
            placeholder="请输入具体提问内容"
          />
        </div>
      </div>
    </div>
  );
}
