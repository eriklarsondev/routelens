import { defineConfig } from 'vite';

// Library mode and no index.html: a package, not a site, so it has no page.
export default defineConfig({
  build: { lib: { entry: 'src/index.ts', formats: ['es'] } },
});
