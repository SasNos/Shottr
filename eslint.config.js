import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'coverage/'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.webextensions },
    },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Injected into the page with chrome.scripting, so it is a classic script, not a module.
    files: ['src/content.js'],
    languageOptions: { sourceType: 'script' },
  },
  {
    files: ['test/**/*.js', 'tools/**/*.mjs', 'eslint.config.js', 'stylelint.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
];
