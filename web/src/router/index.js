import { createRouter, createWebHistory } from "vue-router";

const routes = [
  {
    path: "/",
    name: "SubConverter",
    component: () => import("../views/Subconverter.vue")
  },
  {
    path: "/parse",
    name: "Parse",
    // 解析 / 转格式：订阅地址或节点 -> 多种目标格式
    component: () => import("../views/Parse.vue")
  }
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
});

export default router;
