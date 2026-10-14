import { Link, useMatch } from 'react-router-dom';

export function Nav() {
  const billing = useMatch('/billing');
  const somewhere = useMatch('/nowhere-in-the-table');
  return <Link to="/billing" className={billing || somewhere ? 'on' : ''}>Billing</Link>;
}
