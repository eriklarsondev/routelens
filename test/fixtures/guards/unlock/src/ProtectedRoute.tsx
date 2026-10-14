import { Redirect, Route } from 'react-router-dom';

export default function ProtectedRoute({ component: Component, ...props }: any) {
  return <Route {...props} render={(inner: any) => (window.signedIn ? <Component {...inner} /> : <Redirect to="/login" />)} />;
}
