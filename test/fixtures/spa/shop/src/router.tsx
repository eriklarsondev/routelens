import { createBrowserRouter, Navigate, redirect } from 'react-router-dom';
import { Cart, Layout, Product, Products } from './views';

export const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <Layout />,
      children: [
        { index: true, element: <Products /> },
        { path: 'products/:productId', element: <Product /> },
        {
          path: 'cart',
          children: [
            { index: true, element: <Cart /> },
            { path: 'checkout', element: <Cart /> },
          ],
        },
        { path: 'basket', element: <Navigate to="/cart" replace /> },
        { path: 'admin', loader: () => redirect('/login') },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL },
);
