import { Dispatch, FormEvent, SetStateAction } from "react";
import { RefreshCw, Sliders } from "lucide-react";
import { NotebookLmAuthState } from "../../hooks/useNotebookLmAuth";
import { SystemQuestion } from "../../types";
import { AddQuestionForm } from "./AddQuestionForm";
import { AnnouncementFilterSettings } from "./AnnouncementFilterSettings";
import { NotebookLmStatus } from "./NotebookLmStatus";
import { QuestionList } from "./QuestionList";

interface SettingsProps {
  systemQuestions: SystemQuestion[];
  newQuestionTitle: string;
  setNewQuestionTitle: Dispatch<SetStateAction<string>>;
  newQuestionPrompt: string;
  setNewQuestionPrompt: Dispatch<SetStateAction<string>>;
  notebookLmAuth: NotebookLmAuthState;
  notebookLmAuthMessage: string;
  onAddQuestion: (event: FormEvent) => void;
  onDeleteQuestion: (questionId: string) => void;
  onUpdateQuestionInline: (questionId: string, field: keyof SystemQuestion, value: string) => void;
  onMoveQuestion: (index: number, direction: "up" | "down") => void;
  onResetQuestions: () => void;
  onCheckNotebookLmAuth: () => void;
  announcementFilterInput: string;
  announcementFilterTerms: string[];
  onAnnouncementFilterChange: (value: string) => void;
  onResetAnnouncementFilters: () => void;
}

export function Settings({
  systemQuestions,
  newQuestionTitle,
  setNewQuestionTitle,
  newQuestionPrompt,
  setNewQuestionPrompt,
  notebookLmAuth,
  notebookLmAuthMessage,
  onAddQuestion,
  onDeleteQuestion,
  onUpdateQuestionInline,
  onMoveQuestion,
  onResetQuestions,
  onCheckNotebookLmAuth,
  announcementFilterInput,
  announcementFilterTerms,
  onAnnouncementFilterChange,
  onResetAnnouncementFilters,
}: SettingsProps) {
  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-8 flex flex-col gap-6">
      <header className="flex flex-col sm:flex-row sm:justify-between sm:items-center pb-4 border-b border-slate-200 gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <Sliders className="h-5 w-5 text-blue-600" />
            提问模板设置中心
          </h1>
          <p className="text-xs text-slate-500 font-medium mt-1">
            自定义在大模型或 NotebookLM 中进行尽调底稿分析时的提问问题内容及章节排布顺序。
          </p>
        </div>

        <button
          onClick={onResetQuestions}
          className="bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 font-extrabold text-xs py-2 px-4 rounded-xl flex items-center gap-1.5 transition-all cursor-pointer active:scale-98 self-start sm:self-auto"
        >
          <RefreshCw className="h-3.5 w-3.5 text-blue-500" />
          <span>恢复出厂投行默认问题</span>
        </button>
      </header>

      <NotebookLmStatus
        notebookLmAuth={notebookLmAuth}
        notebookLmAuthMessage={notebookLmAuthMessage}
        onCheckNotebookLmAuth={onCheckNotebookLmAuth}
      />

      <AnnouncementFilterSettings
        announcementFilterInput={announcementFilterInput}
        announcementFilterTerms={announcementFilterTerms}
        onAnnouncementFilterChange={onAnnouncementFilterChange}
        onResetAnnouncementFilters={onResetAnnouncementFilters}
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <AddQuestionForm
          newQuestionTitle={newQuestionTitle}
          setNewQuestionTitle={setNewQuestionTitle}
          newQuestionPrompt={newQuestionPrompt}
          setNewQuestionPrompt={setNewQuestionPrompt}
          onAddQuestion={onAddQuestion}
        />

        <QuestionList
          systemQuestions={systemQuestions}
          onDeleteQuestion={onDeleteQuestion}
          onUpdateQuestionInline={onUpdateQuestionInline}
          onMoveQuestion={onMoveQuestion}
        />
      </div>
    </div>
  );
}
