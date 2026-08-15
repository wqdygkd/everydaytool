import type { RouteRecordRaw } from 'vue-router';
import HomePage from '../pages/HomePage.vue';
import ToolLayout from '../layouts/ToolLayout.vue';
import { getActiveTools } from '../config/tools.js';

export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: HomePage,
    meta: { title: 'everydaytool' },
  },
  {
    path: '/tools',
    component: ToolLayout,
    children: getActiveTools().map((tool) => tool.route as RouteRecordRaw),
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
];
