import { Route, Switch } from 'react-router-dom';
import { SignedIn } from '@clerk/clerk-react';
import { AdminRoute, PrivateRoute, PublicRoute } from './routing';
import { Inbox, Reports, SignIn, Users, Welcome } from './views';

export function Legacy() {
  return (
    <>
      <Switch>
        <Route path="/signin" component={SignIn} />
        <PrivateRoute path="/reports" component={Reports} />
        <AdminRoute path="/users" component={Users} />
        <PublicRoute path="/hello" component={Welcome} />
      </Switch>
      <SignedIn>
        <Switch>
          <Route path="/inbox" component={Inbox} />
        </Switch>
      </SignedIn>
    </>
  );
}
