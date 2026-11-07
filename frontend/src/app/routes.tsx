import type { ReactElement } from 'react';
import {
  BrowserRouter as Router,
  Navigate,
  Route,
  Routes,
} from 'react-router-dom';

import { getAccessToken } from '@api/auth';
import DefaultLayout from '@layout/DefaultLayout';
import AuthPage from '@pages/auth/AuthPage';
import VkCallbackPage from '@pages/auth/VkCallbackPage';
import YandexTokenPage from '@pages/auth/YandexTokenPage';
import HomePage from '@pages/Home/HomePage';

function RequireAuth({ children }: { children: ReactElement }) {
  if (!getAccessToken()) {
    return <Navigate to="/login" replace />;
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
        <Route element={<DefaultLayout />}>
          <Route
            path="/"
            element={
              <RequireAuth>
                <HomePage />
              </RequireAuth>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}
