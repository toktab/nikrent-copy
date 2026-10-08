import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import DetectionPage from './pages/DetectionPage';
import TracePage from './pages/TracePage';
import { AuthGate } from './components/AuthGate';
import { DataGate } from './components/DataGate';
import { ErrorBoundary } from './components/ErrorBoundary';
import { installGlobalErrorHandlers } from './lib/errorLog';
import './styles.css';

installGlobalErrorHandlers();

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

/** Simple pathname check: /detection shows the standalone detection page,
 *  /trace the PDF tracing workspace, and everything else the main formwork
 *  editor. No router needed — the three share zero state and zero components,
 *  and the two PDF pages are deliberately their own tab: the whole screen is
 *  the architect's drawing, with none of the editor around it. */
const path = window.location.pathname;
const isDetectionPage = path === '/detection';
const isTracePage = path === '/trace';

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      {isDetectionPage ? (
        <DetectionPage />
      ) : isTracePage ? (
        <TracePage />
      ) : (
        <AuthGate>
          <DataGate>
            <App />
          </DataGate>
        </AuthGate>
      )}
    </ErrorBoundary>
  </StrictMode>,
);
