import { Navigate, Route, Routes } from "react-router-dom";
import RequireAuth from "./components/RequireAuth.jsx";
import AdminLayout from "./components/AdminLayout.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import OverviewPage from "./pages/OverviewPage.jsx";
import UsersPage from "./pages/UsersPage.jsx";
import UserDetailPage from "./pages/UserDetailPage.jsx";
import CalculatorPage from "./pages/CalculatorPage.jsx";
import PartnerApiKeysPage from "./pages/PartnerApiKeysPage.jsx";
import PlansPage from "./pages/PlansPage.jsx";
import ModelsPage from "./pages/ModelsPage.jsx";
import MetaUsagePage from "./pages/MetaUsagePage.jsx";
import MetaUsageUserPage from "./pages/MetaUsageUserPage.jsx";
import IpManagerPage from "./pages/IpManagerPage.jsx";
import DatabaseMonitorPage from "./pages/DatabaseMonitorPage.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AdminLayout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<OverviewPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/users/:userId" element={<UserDetailPage />} />
        <Route path="/ip-manager" element={<IpManagerPage />} />
        <Route path="/database" element={<DatabaseMonitorPage />} />
        <Route path="/calculator" element={<CalculatorPage />} />
        <Route path="/partner-api-keys" element={<PartnerApiKeysPage />} />
        <Route path="/plans" element={<PlansPage />} />
        <Route path="/models" element={<ModelsPage />} />
        <Route path="/meta-usage" element={<MetaUsagePage />} />
        <Route path="/meta-usage/users/:userId" element={<MetaUsageUserPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
