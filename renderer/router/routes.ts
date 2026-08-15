import type { RouteRecordRaw } from 'vue-router';
import HomePage from '../pages/HomePage.vue';
import ToolLayout from '../layouts/ToolLayout.vue';
import chromeSandbox from '@tools/chrome-sandbox/index.js';
import idCardGenerator from '@tools/id-card-generator/index.js';
import cdpInjector from '@tools/cdp-injector/index.js';

export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: HomePage,
    meta: { title: 'Tool Hub' },
  },
  {
    path: '/tools',
    component: ToolLayout,
    children: [
      chromeSandbox.route as RouteRecordRaw,
      cdpInjector.route as RouteRecordRaw,
      idCardGenerator.route as RouteRecordRaw,
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
];
