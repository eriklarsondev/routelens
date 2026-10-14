import { Redirect } from 'react-router-dom';
import { useTitle } from '../hooks';

/** Billing moved into the account page. */
const Billing = () => {
  useTitle('Billing');
  return <Redirect to="/account?tab=billing" />;
};

export default Billing;
