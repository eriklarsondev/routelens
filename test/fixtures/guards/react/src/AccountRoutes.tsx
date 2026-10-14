import { Route, Routes } from 'react-router-dom';
import { Orders, Overview } from './views';

export default function AccountRoutes() {
  return (
    <Routes>
      <Route index element={<Overview />} />
      <Route path="orders" element={<Orders />} />
    </Routes>
  );
}
