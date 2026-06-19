import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./layouts/AppShell";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { SettingsPage } from "./pages/SettingsPage";
import { isLoggedIn } from "./lib/api";

function ProtectedRoute({ element }: { element: React.ReactElement }) {
  return isLoggedIn() ? element : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <AppShell>
            <Routes>
              <Route path="/" element={<ProtectedRoute element={<DashboardPage />} />} />
              <Route path="/nastavitve" element={<Navigate to="/nastavitve/kategorije" replace />} />
              <Route path="/nastavitve/:tab" element={<ProtectedRoute element={<SettingsPage />} />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AppShell>
        }
      />
    </Routes>
  );
}
