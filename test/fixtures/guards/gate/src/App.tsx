import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from './session';

export function App() {
  const session = useSession();
  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/projects/:id" element={<Project />} />
    </Routes>
  );
}

export function Admin({ isAdmin }: { isAdmin: boolean }) {
  if (!isAdmin) return <Navigate to="/403" />;
  return (
    <Routes>
      <Route path="/admin/users" element={<Users />} />
    </Routes>
  );
}

// Not a gate: what it shows is a spinner, not a sign-in screen.
export function Reports({ data }: { data: unknown }) {
  if (!data) return <Spinner />;
  return (
    <Routes>
      <Route path="/reports" element={<ReportList />} />
    </Routes>
  );
}
