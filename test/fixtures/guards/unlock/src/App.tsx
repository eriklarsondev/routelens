import React from 'react';
import { Route, Switch } from 'react-router-dom';
import Login from './Login';
import Dashboard from './pages/Dashboard';
import ProtectedRoute from './ProtectedRoute';

const VerifyEmail = React.lazy(() => import('./pages/VerifyEmail'));

export function App() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <ProtectedRoute path="/dashboard" component={Dashboard} />
      <Route path="/verify/:id/:token" component={VerifyEmail} />
    </Switch>
  );
}
