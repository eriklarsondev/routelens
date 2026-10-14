import { Navigate, Route, Routes } from 'react-router-dom';
import HelpRoutes from './HelpRoutes';
import { Orders, Profile, Shell } from './views';

export function AccountRoutes() {
  return (
    <Routes>
      <Route path="/account" element={<Shell />}>
        <Route index element={<Profile />} />
        <Route path="orders/:orderId" element={<Orders />} />
        <Route path="old-orders" element={<Navigate to="/account/orders/latest" />} />
      </Route>
      <Route path="/help/*" element={<HelpRoutes />} />
      <Route path="*" element={<Profile />} />
    </Routes>
  );
}
