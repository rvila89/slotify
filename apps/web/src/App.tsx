import { Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LoginPage } from './pages/LoginPage';
import { AppShell, SectionPlaceholder, NotFound } from './components/layout';
import { NuevaConsultaPage, FichaConsultaPage, ReservasPage } from './features/reservas';
import { CalendarioPage } from './features/calendario';
import { ColaEsperaPage } from './features/cola-espera';
import { DashboardPage } from './features/dashboard';
import { InterceptorRegistrar, RequireAuth } from './features/auth';

// QueryClient para estado de servidor (TanStack Query) sobre el cliente API
// generado. Vive aquí (no en main.tsx) para que toda renderización de <App/>
// —incluida la página de login con su mutación— disponga del provider.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * Árbol de rutas (US-000A). Dos layouts independientes:
 *  - Auth (público): `/login` NO monta el AppShell (separación de chrome).
 *  - App (protegido): RequireAuth → AppShell, con sus secciones como hijas del
 *    <Outlet/>. El catch-all "no encontrado" vive DENTRO del shell.
 */
const App = () => (
  <QueryClientProvider client={queryClient}>
    <InterceptorRegistrar />
    <Routes>
    {/* Layout auth (sin chrome del shell) */}
    <Route path="/login" element={<LoginPage />} />

    {/* Layout app (protegido) */}
    <Route element={<RequireAuth />}>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to="/calendario" replace />} />
        {/* US-044 — Dashboard operativo (lectura pura). Nueva entrada del shell;
            la landing post-login sigue siendo /calendario (decisión de gate). */}
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/calendario" element={<CalendarioPage />} />
        <Route path="/reservas" element={<ReservasPage />} />
        <Route path="/reservas/nueva" element={<NuevaConsultaPage />} />
        <Route path="/reservas/:id" element={<FichaConsultaPage />} />
        {/* US-017 — vista de cola de espera (SOLO LECTURA). Destino del clic en
            el indicador 🔁 del calendario (US-039), que navega con el reservaId
            de la bloqueante (helper `rutaCola`). */}
        <Route path="/reservas/:id/cola" element={<ColaEsperaPage />} />
        <Route path="/metricas" element={<SectionPlaceholder nombre="Métricas" />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Route>
    </Routes>
  </QueryClientProvider>
);

export default App;
