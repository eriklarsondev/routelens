import { createBrowserRouter, redirect } from 'react-router-dom';
import { requireUser } from './auth/loaders';
import { ProtectedRoute } from './routing';
import { AppHome, Orders, Reports, Shop, Team } from './views';

export const router = createBrowserRouter([
  { path: '/shop', element: <Shop /> },
  { path: '/my-orders', loader: requireUser, element: <Orders /> },
  {
    path: '/team',
    loader: async () => {
      const user = await getUser();
      if (!user) throw redirect('/login');
      return user;
    },
    element: <Team />,
  },
  {
    path: '/app',
    element: <ProtectedRoute />,
    children: [
      { index: true, element: <AppHome /> },
      { path: 'reports', element: <Reports /> },
    ],
  },
  { path: '/gone', loader: () => redirect('/login') },
]);
