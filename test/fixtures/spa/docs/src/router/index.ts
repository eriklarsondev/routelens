import { createRouter, createWebHistory } from 'vue-router';
import Guide from '../views/Guide.vue';
import Home from '../views/Home.vue';
import NotFound from '../views/NotFound.vue';

const routes = [
  { path: '/', component: Home },
  { path: '/start', redirect: '/guide' },
  {
    path: '/guide',
    component: Guide,
    children: [{ path: ':section', component: Guide }],
  },
  { path: '/:pathMatch(.*)*', component: NotFound },
];

export default createRouter({
  history: createWebHistory('/docs/'),
  routes,
});
