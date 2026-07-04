import { useState } from "react";
import { aiddaApi } from "../api/aidda";

export type NotebookLmAuthState = "unknown" | "checking" | "ok" | "failed";

export function useNotebookLmAuth() {
  const [notebookLmAuth, setNotebookLmAuth] = useState<NotebookLmAuthState>("unknown");
  const [notebookLmAuthMessage, setNotebookLmAuthMessage] =
    useState("尚未检查 NotebookLM 登录状态");

  const handleCheckNotebookLmAuth = async () => {
    setNotebookLmAuth("checking");
    setNotebookLmAuthMessage("正在检查 notebooklm-py 登录状态...");
    try {
      const data = await aiddaApi.checkNotebookLmStatus();
      const status = data.status || {};
      if (status.authenticated) {
        setNotebookLmAuth("ok");
        setNotebookLmAuthMessage(status.message || "NotebookLM 登录正常");
      } else {
        setNotebookLmAuth("failed");
        setNotebookLmAuthMessage(status.message || "NotebookLM 未登录或登录失效");
      }
    } catch (err: any) {
      setNotebookLmAuth("failed");
      setNotebookLmAuthMessage(err.message || "NotebookLM 登录状态检查失败");
    }
  };

  return {
    notebookLmAuth,
    notebookLmAuthMessage,
    handleCheckNotebookLmAuth,
  };
}
