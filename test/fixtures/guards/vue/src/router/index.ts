import { createRouter, createWebHistory } from 'vue-router';
import { authGuard, isAdmin } from './guards';
import { store } from '../store';

const routes = [
  { path: '/', component: Home },
  { path: '/login', component: Login, meta: { guest: true } },
  { path: '/account', component: Account, meta: { requiresAuth: true } },
  {
    path: '/admin',
    component: AdminShell,
    meta: { requiresAuth: true, roles: ['admin'] },
    children: [{ path: 'users', component: Users }],
  },
  { path: '/billing', component: Billing, beforeEnter: authGuard },
  { path: '/reports', component: Reports, beforeEnter: [authGuard, isAdmin] },
  { path: '/inbox', component: Inbox, beforeEnter: (to, from, next) => (store.loggedIn ? next() : next('/login')) },
  { path: '/about', component: About, meta: { requiresAuth: false, title: 'About' } },
];

export default createRouter({ history: createWebHistory(), routes });
