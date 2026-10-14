module.exports = {
  async redirects() {
    return [
      { source: '/old-home', destination: '/', permanent: true },
      { source: '/blog/:slug', destination: '/news/:slug', permanent: false },
    ];
  },
};
