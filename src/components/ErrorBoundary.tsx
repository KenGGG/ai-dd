import { Component, ErrorInfo, PropsWithChildren } from "react";

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("AIDDA UI error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-100 text-slate-900 flex items-center justify-center p-6">
          <div className="max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h1 className="text-base font-extrabold">界面发生错误</h1>
            <p className="mt-2 text-sm text-slate-600">
              请刷新页面重试；如果问题持续出现，请查看浏览器控制台和服务日志。
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700"
            >
              刷新页面
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
