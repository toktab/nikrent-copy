import { Component, type ErrorInfo, type ReactNode } from 'react';
import { STORAGE_KEY } from '../store/useEditorStore';
import { captureError } from '../lib/errorLog';
import { Icon } from './Icon';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Keeps a render error from blanking the whole editor. The user's work lives in
 * localStorage, so the recovery options are "try again" (re-render) and, as a
 * last resort, downloading the raw saved state before clearing it.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The component stack says which part of the tree blew up, which the raw
    // stack trace usually does not after minification.
    void captureError(error, 'render', { componentStack: info.componentStack });
  }

  private downloadState = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) ?? '{}';
      const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'du-formwork-backup.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      /* nothing more we can do */
    }
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="crash">
        <h2>რაღაც შეფერხდა</h2>
        <p>
          რედაქტორმა მოულოდნელი შეცდომა დააფიქსირა. შენი ნახაზი და კატალოგი შენახულია —
          ჯერ სცადე გვერდის განახლება.
        </p>
        <pre>{this.state.error.message}</pre>
        <div className="crash-actions">
          <button className="btn primary" onClick={() => window.location.reload()}>
            გვერდის განახლება
          </button>
          <button className="btn" onClick={this.downloadState}><Icon name="download" /> შენახული მონაცემების ჩამოტვირთვა
          </button>
        </div>
      </div>
    );
  }
}
