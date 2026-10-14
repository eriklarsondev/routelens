import { Redirect, Route } from 'react-router-dom';
import { useSession } from '../hooks';

// The wrapper renders a path-less <Route> and a runtime redirect: neither is a URL.
const ProtectedRoute = ({ component: Component, ...props }: any) => {
  const session = useSession();
  if (!session) return <Redirect to="/signin" />;
  return <Route {...props} render={(inner: any) => <Component {...inner} />} />;
};

export default ProtectedRoute;
