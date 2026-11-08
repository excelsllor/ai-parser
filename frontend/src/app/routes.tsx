import type { ReactElement } from 'react';
import {
  BrowserRouter as Router,
  Navigate,
  Route,
  Routes,
} from 'react-router-dom';

import { getAccessToken, getCurrentUser } from '@api/auth';
import AdminLayout from '@components/admin/AdminLayout';
import AdminLlmPage from '@pages/admin/AdminLlmPage';
import AdminOverviewPage from '@pages/admin/AdminOverviewPage';
import AdminServicesPage from '@pages/admin/AdminServicesPage';
import AdminSourcesPage from '@pages/admin/AdminSourcesPage';
import AdminUsersPage from '@pages/admin/AdminUsersPage';
import AuthPage from '@pages/auth/AuthPage';
import VkCallbackPage from '@pages/auth/VkCallbackPage';
import YandexTokenPage from '@pages/auth/YandexTokenPage';
import ProfilePage from '@pages/profile/ProfilePage';
import RunPage from '@pages/workspace/RunPage';
import WorkspacePage from '@pages/workspace/WorkspacePage';

function RequireAuth({ children }: { children: ReactElement }) {
  if (!getAccessToken()) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

function RequireAdmin({ children }: { children: ReactElement }) {
  if (getCurrentUser()?.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return children;
}

export default function AppRoutes() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<AuthPage />} />
        <Route path="/register" element={<AuthPage />} />
        <Route path="/auth/yandex/token" element={<YandexTokenPage />} />
        <Route path="/auth/vk/callback" element={<VkCallbackPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <WorkspacePage />
            </RequireAuth>
          }
        />
        <Route
          path="/runs/:id"
          element={
            <RequireAuth>
              <RunPage />
            </RequireAuth>
          }
        />
        <Route
          path="/profile"
          element={
            <RequireAuth>
              <ProfilePage />
            </RequireAuth>
          }
        />
        <Route
          path="/admin"
          element={
            <RequireAuth>
              <RequireAdmin>
                <AdminLayout />
              </RequireAdmin>
            </RequireAuth>
          }
        >
          <Route index element={<AdminOverviewPage />} />
          <Route path="sources" element={<AdminSourcesPage />} />
          <Route path="llm" element={<AdminLlmPage />} />
          <Route path="users" element={<AdminUsersPage />} />
          <Route path="services" element={<AdminServicesPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}
