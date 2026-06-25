import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier/flat';
import { FlatCompat } from '@eslint/eslintrc';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const nextFiles = [
  'apps/admin-web/**/*.{ts,tsx,js,jsx}',
  'apps/landing/**/*.{ts,tsx,js,jsx}',
  'apps/client-web/**/*.{ts,tsx,js,jsx}',
];

const nodeFiles = [
  'apps/api/**/*.{ts,js}',
  'apps/client-bff/**/*.{ts,js}',
  'apps/tg-bot/**/*.{ts,js}',
  'libs/**/*.{ts,js}',
];

const testFiles = [
  '**/*.{spec,test}.{ts,tsx,js,jsx}',
  'apps/api/test/**/*.ts',
];

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/build/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/next-env.d.ts',
      '**/*.d.ts',
      'apps/api/src/database/migrations/**',
      'ecosystem.config.js',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },

  {
    files: nodeFiles,
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  ...compat.extends('next/core-web-vitals').map((config) => ({
    ...config,
    files: nextFiles,
  })),
  {
    files: nextFiles,
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },

  {
    files: testFiles,
    languageOptions: {
      globals: { ...globals.jest, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  prettier,
];
