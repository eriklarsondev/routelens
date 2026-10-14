import adapter from '@sveltejs/adapter-auto';

export default {
  kit: {
    adapter: adapter(),
    paths: { base: '/kit' },
  },
};
