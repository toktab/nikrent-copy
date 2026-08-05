import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AuthGate } from './components/AuthGate';
import { DataGate } from './components/DataGate';
import { ErrorBoundary } from './components/ErrorBoundary';
import { installGlobalErrorHandlers } from './lib/errorLog';
import './styles.css';

installGlobalErrorHandlers();

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthGate>
        <DataGate>
          <App />
        </DataGate>
      </AuthGate>
    </ErrorBoundary>
  </StrictMode>,
);
