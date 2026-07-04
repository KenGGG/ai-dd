import { Dispatch, FormEvent, SetStateAction } from "react";
import { Plus } from "lucide-react";

interface AddQuestionFormProps {
  newQuestionTitle: string;
  setNewQuestionTitle: Dispatch<SetStateAction<string>>;
  newQuestionPrompt: string;
  setNewQuestionPrompt: Dispatch<SetStateAction<string>>;
  onAddQuestion: (event: FormEvent) => void;
}

export function AddQuestionForm({
  newQuestionTitle,
  setNewQuestionTitle,
  newQuestionPrompt,
  setNewQuestionPrompt,
  onAddQuestion,
}: AddQuestionFormProps) {
  return (
    <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 shadow-xs flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-extrabold text-slate-800 uppercase tracking-wider flex items-center gap-2">
          <Plus className="h-4 w-4 text-blue-500" />
          新建分析维度提问
        </h3>
        <p className="text-xs text-slate-500 mt-1">设置专属于特定行业或标的的针对性排查提问。</p>
      </div>

      <form onSubmit={onAddQuestion} className="space-y-4">
        <div>
          <label className="text-[10px] uppercase font-extrabold text-slate-500 block mb-1">
            提问标题 / 章节名称
          </label>
          <input
            type="text"
            placeholder="例：募集资金用途与合理性评估"
            value={newQuestionTitle}
            onChange={(event) => setNewQuestionTitle(event.target.value)}
            className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 text-slate-900 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 focus:bg-white transition-all font-semibold"
          />
        </div>

        <div>
          <label className="text-[10px] uppercase font-extrabold text-slate-500 block mb-1">
            提问问题内容 (Prompt / Content)
          </label>
          <textarea
            placeholder="请在大模型或 NotebookLM 提问中写明：在底稿中抓取什么信息、需要核验哪些具体数值，并要求输出标注原始页码。"
            rows={6}
            value={newQuestionPrompt}
            onChange={(event) => setNewQuestionPrompt(event.target.value)}
            className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 text-slate-900 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 focus:bg-white transition-all font-semibold resize-none leading-relaxed"
          />
        </div>

        <button
          type="submit"
          disabled={!newQuestionTitle.trim() || !newQuestionPrompt.trim()}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-md shadow-blue-600/10 active:scale-98 cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          <span>添加该提问维度至系统库</span>
        </button>
      </form>
    </div>
  );
}
