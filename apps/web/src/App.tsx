import { Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LoginPage } from './pages/LoginPage';
import { AppShell, SectionPlaceholder, NotFound } from './components/layout';
import { NuevaConsultaPage, FichaConsultaPage } from './features/reservas';
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
        <Route path="/calendario" element={<SectionPlaceholder nombre="Calendario" />} />
        <Route path="/reservas" element={<SectionPlaceholder nombre="Reservas" />} />
        <Route path="/reservas/nueva" element={<NuevaConsultaPage />} />
        <Route path="/reservas/:id" element={<FichaConsultaPage />} />
        <Route path="/metricas" element={<SectionPlaceholder nombre="Métricas" />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Route>
    </Routes>
  </QueryClientProvider>
);

export default App;
