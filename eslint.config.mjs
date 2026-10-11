import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // テストでは外部APIの応答を模した any や、動的な require を許可する
    files: ['tests/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  globalIgnores(['.next/**', '.open-next/**', '.wrangler/**', 'next-env.d.ts']),
]);
