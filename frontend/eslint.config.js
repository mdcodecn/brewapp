// ESLint flat config（eslint 10）
// 该项目为遗留 vanilla JS 单文件应用（大量 window.* 全局导出与 inline onclick），
// 规则保持宽松：重点捕获未定义变量、未使用表达式等真 bug，避免历史代码噪音。
'use strict';

const js = require('@eslint/js');

module.exports = [
  {
    ignores: ['dist/**', 'node_modules/**', 'wailsjs/**'],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        requestAnimationFrame: 'readonly',
      },
    },
    rules: {
      // 遗留代码风格：允许未使用变量/参数与 catch 捕获后不用的 err
      // （大量"静默失败"分支是有意为之）
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      // 允许 window.xxx = fn 的全局导出模式
      'no-undef': 'error',
      // 允许空 catch（大量"静默失败"分支是有意为之）
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // 不强制遗留代码在 throw 时附带 cause（preserve-caught-error 属推荐新增，
      // 改动面大且不影响行为，暂不启用）
      'preserve-caught-error': 'off',
      // 其余推荐规则保留，仅降级为 warn 以免噪音阻碍开发
      'no-constant-condition': 'warn',
      'no-cond-assign': 'warn',
      'no-dupe-keys': 'warn',
      'no-unreachable': 'warn',
      'no-constant-binary-expression': 'warn',
      'no-prototype-builtins': 'off',
    },
  },
];
