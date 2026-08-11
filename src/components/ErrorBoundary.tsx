import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { reportClientError } from '../utils/clientErrorReporter';

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App render failed', error, info.componentStack);
    reportClientError({
      source: 'render',
      message: error.message || error.name,
      stack: error.stack,
      componentStack: info.componentStack || '',
    });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="app-shell min-h-screen p-6">
        <section className="mx-auto mt-16 max-w-xl rounded-lg border border-danger bg-surface-strong p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-danger-soft p-2 text-danger">
              <AlertTriangle size={22} />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-primary">页面渲染失败</h1>
              <p className="mt-2 text-sm leading-6 text-secondary">当前页面出现未捕获错误。可以刷新重试；如果重复出现，请到运维观察台查看日志。</p>
              <pre className="mt-4 max-h-40 overflow-auto rounded-lg bg-surface-muted p-3 text-xs leading-5 text-secondary">{this.state.error.message}</pre>
              <button className="btn btn-primary mt-4" onClick={() => window.location.reload()}>
                <RefreshCw size={16} />刷新页面
              </button>
            </div>
          </div>
        </section>
      </main>
    );
  }
}
