import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { RequireAuth } from './app/RequireAuth';
import { AppShell } from './app/AppShell';
import { SectionPlaceholder } from './app/SectionPlaceholder';
import { NotFound } from './app/NotFound';

/**
 * Árbol de rutas (US-000A). Dos layouts independientes:
 *  - Auth (público): `/login` NO monta el AppShell (separación de chrome).
 *  - App (protegido): RequireAuth → AppShell, con sus secciones como hijas del
 *    <Outlet/>. El catch-all "no encontrado" vive DENTRO del shell.
 */
const App = () => (
  <Routes>
    {/* Layout auth (sin chrome del shell) */}
    <Route path="/login" element={<LoginPage />} />

    {/* Layout app (protegido) */}
    <Route element={<RequireAuth />}>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to="/calendario" replace />} />
        <Route path="/calendario" element={<SectionPlaceholder nombre="Calendario" />} />
        <Route path="/reservas" element={<SectionPlaceholder nombre="Reservas" />} />
        <Route path="/metricas" element={<SectionPlaceholder nombre="Métricas" />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Route>
  </Routes>
);

export default App;
