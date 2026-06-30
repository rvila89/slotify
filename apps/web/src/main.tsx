import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { SessionProvider } from './features/auth';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('No se encontro el elemento #root en index.html');
}

// SessionProvider envuelve el router: la sesión vive en memoria (REQ 10) y la
// navegación tras login la resuelven los hooks dentro del árbol del router.
// El QueryClientProvider lo aporta <App/> (estado de servidor).
createRoot(rootElement).render(
  <StrictMode>
    <SessionProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </SessionProvider>
  </StrictMode>,
);
