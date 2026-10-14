import { Redirect } from 'react-router-dom';

/** Redirects only when signed out, so it is a page, not a redirect. */
export default function Account({ user }: { user?: { name: string } }) {
  if (!user) return <Redirect to="/login" />;
  return <section>{user.name}</section>;
}
