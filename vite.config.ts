import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

/**
 * PWA 配置（2026-09-29 接入）。
 *
 * 目标口径由用户拍板：**离线可用，更新时机交给用户** ——
 * 装好之后除"取新版本"外不再联网（本应用运行时零网络请求：数据全在 localStorage，
 * 见 `src/api/index.ts` 的 mock 分支），所以 SW 只需要缓存静态外壳。
 *
 * 三个不显然的选项，改动前先读：
 *   1. `registerType: 'prompt'` + `injectRegister: null` —— 不静默刷新、也不让插件
 *      自动注入注册代码。注册由 `src/services/pwa.ts` 自己做：设置页的「检查更新」
 *      需要拿到 `ServiceWorkerRegistration`，而"有新版待应用"这个状态要喂给 UI。
 *   2. `globPatterns` 里的 `js` 覆盖到**按需 import 的三个库**（yuhun / bounty / souls）——
 *      漏掉它们，离线点开「御魂 / 式神」就会失败，而那正是最需要离线查的东西。
 *   3. 图标 PNG 由 `npm run icons`（`tools/make-icons.mjs`）从 `public/favicon.svg` 生成，
 *      不手工做（四张图各自的比例与理由写在那个脚本里）。
 */
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: '囤囤鼠 · 阴阳师任务清单',
        short_name: '囤囤鼠',
        description: '纯手动记录的阴阳师奖励自查清单 —— 离线可用，数据只存本机',
        lang: 'zh-CN',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        /* 与 `index.html` 那两条 `theme-color` 同值（亮色取和纸底）：`background_color`
           是启动画面底色，`theme_color` 是独立模式下状态栏 / 任务切换器的染色 */
        theme_color: '#F5EFE3',
        background_color: '#F5EFE3',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/pwa-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        /* 自定义通知点击：聚焦已有窗口并发消息，冷启动则带 ?nurture=1 打开 */
        importScripts: ['nurture-notification-sw.js'],
        /* 应用只有状态切换、没有 URL 路由，回退是保底（刷新子路径时不至于 404） */
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
