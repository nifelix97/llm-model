import { Route, Routes } from "react-router-dom";
import ProtectedRoute from "../components/ProtectedRoute";
import DashboardPage from "../pages/DashboardPage";
import DataLakePage from "../pages/DataLakePage";
import LandingPage from "../pages/LandingPage";
import LoginPage from "../pages/LoginPage";
import ModelConfigPage from "../pages/ModelConfigPage";
import NotFoundPage from "../pages/NotFoundPage";
import PolicyOptimizePage from "../pages/PolicyOptimizePage";
import PromptPage from "../pages/PromptPage";
import PolicyMonitoring from "../pages/PolicyMonitoring";
import UserManagementPage from "../pages/UserManagementPage";

function AppRoutes() {
  return (
    <Routes>
      {/* ── Public routes ── */}
      <Route path="/"      element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />

      {/* ── Protected routes (require login) ── */}
      <Route path="/dashboard" element={
        <ProtectedRoute permission="dashboard:view"><DashboardPage /></ProtectedRoute>
      } />
      <Route path="/prompt" element={
        <ProtectedRoute permission="prompt:use"><PromptPage /></ProtectedRoute>
      } />
      <Route path="/optimize" element={
        <ProtectedRoute permission="optimize:run"><PolicyOptimizePage /></ProtectedRoute>
      } />
      <Route path="/datalake" element={
        <ProtectedRoute permission="data:view"><DataLakePage /></ProtectedRoute>
      } />
      <Route path="/models/new" element={
        <ProtectedRoute permission="data:manage"><ModelConfigPage /></ProtectedRoute>
      } />
      <Route path="/monitoring" element={
        <ProtectedRoute permission="monitoring:view"><PolicyMonitoring /></ProtectedRoute>
      } />
      <Route path="/users" element={<ProtectedRoute permission="users:manage"><UserManagementPage /></ProtectedRoute>} />

      {/* ── Fallback ── */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export default AppRoutes;
