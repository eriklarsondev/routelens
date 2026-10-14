import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from './routes';

export function Root() {
  return (
    <BrowserRouter basename={import.meta.env.VITE_BASE_PATH || '/portal'}>
      <AppRoutes />
    </BrowserRouter>
  );
}
