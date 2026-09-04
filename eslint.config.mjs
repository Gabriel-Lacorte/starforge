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
                    maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 20,
                    allowDefaultProject: [
                        'vitest.config.ts',
                        'playwright.config.ts',
                        'e2e/*.ts',
                        'tools/*.ts',
                    ],
                    defaultProject: 'tsconfig.e2e.json',
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
                            group: [
                                '*/engine',
                                '*/gesture',
                                '**/render/*',
                                '**/document/*',
                                '**/input/*',
                                '**/selection/*',
                                '**/transform/*',
                            ],
                            message:
                                'UI is declarative: it reads controllers, stores and the tool catalog, never the engine.',
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
                            group: ['**/ui/*', '**/document/*'],
                            message:
                                'The render layer draws what it is given: no UI, no document session.',
                        },
                    ],
                },
            ],
        },
    },
    {
        files: ['client/src/storage/**', 'client/src/project/**'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['**/ui/*', '**/render/*', '**/input/*'],
                            message: 'Persistence works on documents, never on what is on screen.',
                        },
                    ],
                },
            ],
        },
    },
    {
        files: ['core/src/**/*.ts'],
        ignores: ['core/src/**/*.test.ts', 'core/src/**/*.bench.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            regex: '^[^.]',
                            message:
                                'The core has zero dependencies: it imports only its own modules.',
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

    {
        files: ['docs/**/*.mjs'],
        languageOptions: {
            globals: { console: 'readonly', process: 'readonly', setTimeout: 'readonly' },
        },
    },
)
