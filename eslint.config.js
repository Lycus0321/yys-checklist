import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

/**
 * 分层铁律的强制手段（设计文档 §2）：
 *   「JSON 文件只能被 src/api/mock/db.ts 引用」—— 违反即报错。
 * 这是整套设计能不能活到接后端那天的唯一保障。
 */
const JSON_BAN = [
  'error',
  {
    patterns: [
      {
        group: ['**/db/*.db.json', '**/db/*.json', '@/db/*'],
        message:
          '禁止 import 数据库 JSON：种子只能被 src/api/mock/db.ts 引用（设计文档 §2 铁律）。业务代码请经 ApiClient 契约取数。',
      },
    ],
  },
];

export default tseslint.config(
  {
    ignores: [
      'dist',
      'node_modules',
      'android',
      'data',
      'prototype',
      'src/db',
      'reports',
      '*.config.js',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-restricted-imports': JSON_BAN,
    },
  },
  {
    /* 唯一豁免：种子读取处 */
    files: ['src/api/mock/db.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
);
