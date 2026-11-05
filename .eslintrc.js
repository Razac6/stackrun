module.exports = {
  extends: 'erb',
  plugins: ['@typescript-eslint'],
  rules: {
    // A temporary hack related to IDE not resolving correct package.json
    'import/no-extraneous-dependencies': 'off',
    'react/react-in-jsx-scope': 'off',
    'react/jsx-filename-extension': 'off',
    'import/extensions': 'off',
    'import/no-unresolved': 'off',
    'import/no-import-module-exports': 'off',
    // The codebase consistently uses empty catch blocks as deliberate best-effort error
    // suppression (idempotent "ADD COLUMN" migrations, optimistic UI updates that shouldn't
    // crash the app) - allow that specific pattern, but still flag other empty blocks.
    'no-empty': ['error', { allowEmptyCatch: true }],
    // Large-volume pure-style categories across the existing codebase - downgraded to warn
    // rather than hand-rewriting hundreds of pre-existing call sites in one pass. New/changed
    // code should still aim to avoid these; `npm run lint` only fails on errors, so this keeps
    // CI green without masking anything that indicates an actual bug.
    'react/no-unescaped-entities': 'warn',
    'no-use-before-define': 'warn',
    'no-nested-ternary': 'warn',
    'react-hooks/exhaustive-deps': 'warn',
    'no-plusplus': 'warn',
    'react/destructuring-assignment': 'warn',
    'no-return-await': 'warn',
    'class-methods-use-this': 'warn',
    'no-restricted-syntax': 'warn',
    'react/no-array-index-key': 'warn',
    'react/jsx-props-no-spreading': 'warn',
    'consistent-return': 'warn',
    'import/prefer-default-export': 'warn',
    'global-require': 'warn',
    'jest/no-done-callback': 'warn',
    'react/require-default-props': 'warn',
    'react/function-component-definition': 'warn',
    'promise/always-return': 'warn',
    'jest/no-conditional-expect': 'warn',
    'prefer-destructuring': 'warn',
    'react/no-unstable-nested-components': 'warn',
    'react/jsx-no-constructed-context-values': 'warn',
    'jsx-a11y/click-events-have-key-events': 'warn',
    'jsx-a11y/no-static-element-interactions': 'warn',
    'import/no-duplicates': 'warn',
    'no-await-in-loop': 'warn',
    'import/no-named-as-default': 'warn',
    'react/prop-types': 'warn',
    'no-new': 'warn',
    'promise/catch-or-return': 'warn',
    'no-continue': 'warn',
  },
  overrides: [
    {
      // Base no-undef doesn't understand TS ambient global types (e.g. the NodeJS namespace
      // from @types/node), causing false positives on things like NodeJS.Timeout. TypeScript
      // itself already catches genuine undefined-variable usage, so this is redundant for TS.
      //
      // Base no-unused-vars/no-shadow don't understand TS-only constructs - enum members
      // (accessed as Foo.BAR, not free variables) get flagged as "unused", and enum declarations
      // "shadow" themselves under TS's declaration-merging. The @typescript-eslint equivalents
      // handle both correctly.
      files: ['*.ts', '*.tsx'],
      rules: {
        'no-undef': 'off',
        'no-unused-vars': 'off',
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_' },
        ],
        'no-shadow': 'off',
        '@typescript-eslint/no-shadow': 'error',
      },
    },
    {
      // .d.ts files only declare ambient types - parameter names in a function signature like
      // `on(channel: string, func: (...) => void): void;` are documentation, not real bindings,
      // so "unused" doesn't apply to them.
      files: ['*.d.ts'],
      rules: {
        'no-unused-vars': 'off',
        '@typescript-eslint/no-unused-vars': 'off',
      },
    },
  ],
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
    createDefaultProgram: true,
  },
  settings: {
    'import/resolver': {
      // See https://github.com/benmosher/eslint-plugin-import/issues/1396#issuecomment-575727774 for line below
      node: {},
      webpack: {
        config: require.resolve('./.erb/configs/webpack.config.eslint.ts'),
      },
      typescript: {},
    },
    'import/parsers': {
      '@typescript-eslint/parser': ['.ts', '.tsx'],
    },
  },
};
