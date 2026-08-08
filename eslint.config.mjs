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
            '@typescript-eslint/no-confusing-void-expression': [
                'error',
                { ignoreVoidReturningFunctions: true },
            ],
            '@typescript-eslint/consistent-type-imports': 'error',
            '@typescript-eslint/switch-exhaustiveness-check': 'error',
            '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
            '@typescript-eslint/no-non-null-assertion': 'off',
        },
    },

    {
        files: ['client/src/editor/ui/**'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['*/engine', '*/gesture', '**/render/*', '**/document/*'],
                            message:
                                'UI is declarative — it must not import the engine/render/document layer.',
                        },
                    ],
                },
            ],
        },
    },
    {
        files: ['client/src/render/**'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['**/ui/*'],
                            message: 'The render layer must not import UI components.',
                        },
                    ],
                },
            ],
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
