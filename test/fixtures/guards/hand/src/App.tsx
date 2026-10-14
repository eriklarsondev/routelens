import { useLocation, useMatch, useNavigate } from 'react-router-dom';
import { useAuth } from './auth';

export function App() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const taskDetail = useMatch('/tasks/:taskId');
  const reset = useMatch({ path: '/reset-password', end: true });

  if (loading) return <Spinner />;
  if (reset) return <ResetPassword />;
  if (!user) return <AuthScreen />;

  const path = location.pathname;
  if (taskDetail) return <TaskDetail id={taskDetail.params.taskId} />;
  switch (path) {
    case '/archive':
      return <Archive />;
    case '/settings':
      return <Settings onDone={() => navigate('/archive')} />;
    default:
      return <Tasks />;
  }
}
