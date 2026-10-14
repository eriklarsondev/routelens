import { Navigate, Route, Routes } from 'react-router-dom';
import AccountRoutes from './AccountRoutes';
import { RequireAuth, RequireRole } from './auth/guards';
import { AuthLayout, ProtectedLayout } from './layouts';
import { Admin, Billing, Dashboard, Home, Login, Profile, Register, Settings, Welcome } from './views';

export function App({ user }: { user: unknown }) {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      {/* Steps of an auth flow: opened from the link an email sends, not browsed to. */}
      <Route path="/users/:id/verify/:token" element={<Verify />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      {/* The layout for the sign-in pages, not a check in front of them. */}
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
      </Route>
      <Route element={<ProtectedLayout />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="/billing" element={<RequireAuth><Billing /></RequireAuth>} />
      <Route path="/admin" element={<RequireRole role="admin"><Admin /></RequireRole>} />
      <Route path="/profile" element={user ? <Profile /> : <Navigate to="/login" replace />} />
      <Route path="/account/*" element={<RequireAuth><AccountRoutes /></RequireAuth>} />
      <Route path="/welcome" element={<GuestRoute><Welcome /></GuestRoute>} />
      <Route path="/old-billing" element={<Navigate to="/billing" />} />
    </Routes>
  );
}
