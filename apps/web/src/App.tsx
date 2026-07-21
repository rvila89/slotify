import { Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LoginPage } from './pages/LoginPage';
import { AppShell, SectionPlaceholder, NotFound } from './components/layout';
import { Toaster } from './components/ui/sonner';
import { NuevaConsultaPage, FichaConsultaPage, ReservasPage } from './features/reservas';
import { HistoricoPage, DetalleHistoricoPage } from './features/historico';
import { CalendarioPage } from './features/calendario';
import { ColaEsperaPage } from './features/cola-espera';
import { DashboardPage } from './features/dashboard';
import { AuthBootstrap, InterceptorRegistrar, RequireAuth } from './features/auth';

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
    {/* Recuperación de sesión en recarga (F5): intenta rehidratar desde la cookie
        de refresh al arrancar. Resuelve el estado `recovering` del provider. */}
    <AuthBootstrap />
    {/* Host global de notificaciones (Sonner). Se monta una única vez aquí para
        que cualquier `toast.*()` del árbol (login incluido) se renderice. */}
    <Toaster />
    <Routes>
    {/* Layout auth (sin chrome del shell) */}
    <Route path="/login" element={<LoginPage />} />

    {/* Layout app (protegido) */}
    <Route element={<RequireAuth />}>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        {/* US-044 — Dashboard operativo (lectura pura). Es la landing post-login
            y la entrada por defecto del shell. */}
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/calendario" element={<CalendarioPage />} />
        <Route path="/reservas" element={<ReservasPage />} />
        <Route path="/reservas/nueva" element={<NuevaConsultaPage />} />
        <Route path="/reservas/:id" element={<FichaConsultaPage />} />
        {/* US-017 — vista de cola de espera (SOLO LECTURA). Destino del clic en
            el indicador 🔁 del calendario (US-039), que navega con el reservaId
            de la bloqueante (helper `rutaCola`). */}
        <Route path="/reservas/:id/cola" element={<ColaEsperaPage />} />
        {/* US-042 — Histórico de reservas cerradas (búsqueda + filtros, lectura
            pura). El detalle reutiliza `GET /reservas/{id}` en MODO LECTURA. */}
        <Route path="/historico" element={<HistoricoPage />} />
        <Route path="/historico/:id" element={<DetalleHistoricoPage />} />
        <Route
          path="/metricas"
          element={<SectionPlaceholder nombre="Métricas" titulo="Panel de métricas" />}
        />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Route>
    </Routes>
  </QueryClientProvider>
);

export default App;
