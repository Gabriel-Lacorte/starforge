import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import tseslint from 'typescript-eslint'

export default defineConfig(
    globalIgnores(['**/dist/', 'coverage/']),

    {
        files: ['**/*.{ts,tsx}'],
        extends: [
            js.configs.recommended,
            tseslint.configs.strictTypeChecked,
            tseslint.configs.stylisticTypeChecked,
        ],
        languageOptions: {
            parserOptions: {
                projectService: {
                    allowDefaultProject: ['vitest.config.ts'],
                },
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            eqeqeq: 'error',
            '@typescript-eslint/consistent-type-imports': 'error',
            '@typescript-eslint/switch-exhaustiveness-check': 'error',
            '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
        },
    },

    {
        files: ['**/*.test.ts'],
        rules: {
            '@typescript-eslint/no-non-null-assertion': 'off',
        },
    },

    {
        files: ['**/*.{js,mjs}'],
        extends: [js.configs.recommended, tseslint.configs.recommended],
    },
)
