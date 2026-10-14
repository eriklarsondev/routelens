import { Link, useHistory } from 'react-router-dom';

export function Footer({ userId }: { userId: string }) {
  const history = useHistory();
  return (
    <footer>
      <Link to="/support">Support</Link>
      {/* React Router matches paths case-insensitively. */}
      <Link to="/HELP">Help</Link>
      <Link to="/nowhere">A page that does not exist</Link>
      <Link to={`/users/${userId}`}>Profile</Link>
      <Link to={{ pathname: '/reports', search: '?year=2026' }}>Reports</Link>
      {/* Relative to wherever the user is: left out rather than guessed. */}
      <Link to="settings">Settings</Link>
      <button onClick={() => history.push('/old/7')}>Old</button>
      <button onClick={() => history.push('/invoices')}>Invoices</button>
    </footer>
  );
}
