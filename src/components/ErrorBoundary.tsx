import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { summarizeUnknownError } from "../utils/logging";

interface Props {
  children?: ReactNode;
  onReset?: () => void;
  className?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", {
      error: summarizeUnknownError(error),
      componentStackLength: errorInfo.componentStack?.length || 0,
    });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className={`flex flex-col items-center justify-center p-12 text-center bg-white dark:bg-neutral-900/50 rounded-[2.5rem] border border-red-100 dark:border-red-500/20 m-6 shadow-2xl shadow-red-500/5 transition-colors ${this.props.className || 'min-h-[400px]'}`}>
          <div className="w-20 h-20 bg-red-50 dark:bg-red-500/10 rounded-[1.5rem] flex items-center justify-center mb-8 shadow-inner">
            <AlertTriangle className="w-10 h-10 text-red-500" />
          </div>
          <h2 className="text-xl font-black text-gray-900 dark:text-white mb-3 uppercase tracking-tight">出错了</h2>
          <p className="text-[10px] font-black text-gray-400 dark:text-neutral-500 mb-10 max-w-md uppercase tracking-widest leading-relaxed">
            {this.state.error?.message || "发生了一些意外错误，导致页面无法正常显示。"}
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              if (this.props.onReset) {
                this.props.onReset();
              } else {
                window.location.reload();
              }
            }}
            className="flex items-center gap-2 px-8 py-4 bg-red-600 hover:bg-red-700 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-red-500/20 active:scale-95"
          >
            <RefreshCw className="w-4 h-4" />
            {this.props.onReset ? '重试' : '刷新页面重试'}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
