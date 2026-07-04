import { FormEvent, useState } from "react";
import { DEFAULT_QUESTIONS } from "../constants/defaults";
import { LOCAL_STORAGE_QUESTIONS_KEY } from "../constants/storage-keys";
import { SystemQuestion } from "../types";

export function useQuestions() {
  const [systemQuestions, setSystemQuestions] = useState<SystemQuestion[]>(() => {
    const storedQuestions = localStorage.getItem(LOCAL_STORAGE_QUESTIONS_KEY);
    if (storedQuestions) {
      try {
        return JSON.parse(storedQuestions);
      } catch {
        return DEFAULT_QUESTIONS;
      }
    }
    localStorage.setItem(LOCAL_STORAGE_QUESTIONS_KEY, JSON.stringify(DEFAULT_QUESTIONS));
    return DEFAULT_QUESTIONS;
  });
  const [newQuestionTitle, setNewQuestionTitle] = useState("");
  const [newQuestionPrompt, setNewQuestionPrompt] = useState("");
  const [newQuestionSys, setNewQuestionSys] = useState("");

  const saveQuestions = (updatedQuestions: SystemQuestion[]) => {
    setSystemQuestions(updatedQuestions);
    localStorage.setItem(LOCAL_STORAGE_QUESTIONS_KEY, JSON.stringify(updatedQuestions));
  };

  const handleAddQuestion = (e: FormEvent) => {
    e.preventDefault();
    if (!newQuestionTitle.trim() || !newQuestionPrompt.trim()) {
      alert("请输入提问模块名称及 Prompt 提词");
      return;
    }

    const newQuestion: SystemQuestion = {
      id: "q-custom-" + Date.now(),
      title: newQuestionTitle.trim(),
      prompt: newQuestionPrompt.trim(),
      systemInstruction:
        newQuestionSys.trim() ||
        "您是一位资深的证券合规审计专家。请根据公司披露之公告，提取客观条理的信息并必须标志原始页码。",
    };

    saveQuestions([...systemQuestions, newQuestion]);
    setNewQuestionTitle("");
    setNewQuestionPrompt("");
    setNewQuestionSys("");
  };

  const handleDeleteQuestion = (questionId: string) => {
    if (systemQuestions.length <= 1) {
      alert("配置限制：系统中必须最少保留 1 个核心提问分析模块。");
      return;
    }
    if (!window.confirm("确定要删除该分析提词模块吗？")) return;
    saveQuestions(systemQuestions.filter((question) => question.id !== questionId));
  };

  const handleUpdateQuestionInline = (
    questionId: string,
    field: keyof SystemQuestion,
    value: string,
  ) => {
    saveQuestions(
      systemQuestions.map((question) =>
        question.id === questionId ? { ...question, [field]: value } : question,
      ),
    );
  };

  const handleMoveQuestion = (index: number, direction: "up" | "down") => {
    if (direction === "up" && index === 0) return;
    if (direction === "down" && index === systemQuestions.length - 1) return;

    const targetIndex = direction === "up" ? index - 1 : index + 1;
    const updated = [...systemQuestions];
    const current = updated[index];
    updated[index] = updated[targetIndex];
    updated[targetIndex] = current;
    saveQuestions(updated);
  };

  const handleResetQuestions = () => {
    if (!window.confirm("确定要清空自定义并恢复默认的三大核心投行分析提词吗？")) return;
    saveQuestions(DEFAULT_QUESTIONS);
  };

  return {
    systemQuestions,
    newQuestionTitle,
    setNewQuestionTitle,
    newQuestionPrompt,
    setNewQuestionPrompt,
    handleAddQuestion,
    handleDeleteQuestion,
    handleUpdateQuestionInline,
    handleMoveQuestion,
    handleResetQuestions,
  };
}
