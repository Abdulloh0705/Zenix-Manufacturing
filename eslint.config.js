// Lint gate for src/, tests/ and scripts/. Formatting is not linted: the codebase keeps its compact house style
// and mass reformatting would bury real changes in the diff.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import globals from 'globals'

export default tseslint.config(
  {ignores:['dist','.test-dist','node_modules','playwright-report','test-results','src/styles.css']},
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files:['src/**/*.{ts,tsx}','tests/ui/**/*.{ts,tsx}','e2e/**/*.ts'],
    languageOptions:{globals:{...globals.browser}},
    plugins:{'react-hooks':reactHooks,'jsx-a11y':jsxA11y},
    rules:{
      // Classic hook rules are errors. The React Compiler rules of v7 are not enabled: the app does not use the
      // compiler, and its idioms (refs read in handlers, state reset in effects) are deliberate here.
      'react-hooks/rules-of-hooks':'error',
      'react-hooks/exhaustive-deps':'warn',
      ...jsxA11y.flatConfigs.recommended.rules,
      // Labels are associated through wrapping and aria attributes the rule cannot follow across components.
      'jsx-a11y/label-has-associated-control':'off',
      // autoFocus is used only in dialogs, where moving focus into the dialog is the expected behaviour.
      'jsx-a11y/no-autofocus':'off',
    },
  },
  {
    rules:{
      '@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_',varsIgnorePattern:'^_',caughtErrors:'none',ignoreRestSiblings:true}],
      // Debug output must not ship; errors and warnings are reported on purpose.
      'no-console':['error',{allow:['error','warn']}],
      'eqeqeq':['error','smart'],
      'no-empty':['error',{allowEmptyCatch:true}],
    },
  },
  {
    files:['scripts/**/*.mjs','tests/**/*.mjs','*.config.{js,ts}','playwright.config.ts'],
    languageOptions:{globals:{...globals.node}},
    rules:{'no-console':'off'},
  },
)
