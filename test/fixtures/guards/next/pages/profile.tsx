import { withPageAuthRequired } from '@auth0/nextjs-auth0/client';

function Profile() {
  return <main>profile</main>;
}

export default withPageAuthRequired(Profile);
