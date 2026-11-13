import AppRoutes from '@app/routes';
import { ToastProvider } from '@context/ToastContext';

export default function App() {
  return (
    <ToastProvider>
      <AppRoutes />
    </ToastProvider>
  );
}
