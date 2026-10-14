import React from 'react';
import { Redirect, Route, Switch } from 'react-router-dom';
import Account from './pages/Account';
import { PATHS as P } from './paths';
import ProtectedRoute from './routing/ProtectedRoute';

const Billing = React.lazy(() => import('./pages/Billing'));
const Home = () => <main>home</main>;
const Reports = () => <main>reports</main>;

// Kept so old links still work: it renders nothing but a redirect.
const LegacySettings = ({ match }: { match: { params: { id: string } } }) => (
  <Redirect to={`/settings/${match.params.id}?tab=general`} />
);

const ROUTES = { reports: '/reports' };

export function AppRoutes({ flagged }: { flagged: boolean }) {
  return (
    <Switch>
      <Route exact path="/" component={Home} />
      <Route path="/users/:userId" component={Home} />
      <ProtectedRoute path="/account" component={Account} />
      <Route path={['/help', '/support']} component={Home} />
      <Route path={ROUTES.reports} component={Reports} />
      {flagged && <ProtectedRoute path="/beta" component={Home} />}
      {/* A path constant imported from another module, under an alias. */}
      <Route path={P.invoices} component={Home} />
      {flagged ? <Route path={P.team} component={Home} /> : null}
      <Route path="/billing" component={Billing} />
      <Route path="/legacy-settings/:id" component={LegacySettings} />
      <Route
        path="/old/:id"
        render={({ match, location }) => (
          <Redirect to={`/users/${match.params.id}${location.search}`} />
        )}
      />
      {/* <Route path="/commented-out" component={Home} /> */}
      <Redirect from="/home" to="/" />
      <Redirect to="/" />
    </Switch>
  );
}
