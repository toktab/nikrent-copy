import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import DetectionPage from './pages/DetectionPage';
import { AuthGate } from './components/AuthGate';
import { DataGate } from './components/DataGate';
import { ErrorBoundary } from './components/ErrorBoundary';
import { installGlobalErrorHandlers } from './lib/errorLog';
import './styles.css';

installGlobalErrorHandlers();

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

/** Simple pathname check: /detection shows the standalone detection page,
 *  everything else shows the main formwork editor. No router needed —
 *  the two apps share zero state and zero components. */
const isDetectionPage = window.location.pathname === '/detection';

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      {isDetectionPage ? (
        <DetectionPage />
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
