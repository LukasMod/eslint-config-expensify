# eslint-config-expensify

[![npm version](https://badge.fury.io/js/eslint-config-expensify.svg)](http://badge.fury.io/js/eslint-config-expensify)

This package provides Expensify's `.eslintrc` as an extensible shared config. Most of our rules are based on [Airbnb's style guide](https://github.com/airbnb/javascript).

## How to Develop

1. You only need to make a PR with the changes. There is no need to bump the version in `package.json` file in your PR. A github action will automatically bump the version and publish the package to npm after PR is merged.

### Testing

After you have submitted a PR,

1. Get the full commitID of the last commit in your PR, and run `npm install git+https://github.com/Expensify/eslint-config-expensify.git#COMMIT_ID` in the repo against which you want to test those changes.
2. This should update the resolved path of `eslint-config-expensify` in `package-lock.json` file, and ensures the repo is referencing to the correct local version of the eslint config.
3. Now, you can run `npm run lint` or perform any other tests you want in that repo.

### After PR is merged
1. A GitHub action will automatically bump the version and publish the package to npm after PR is merged.
1. Go into the App, Web-Expensify and Web-Secure repos and run `npm install eslint-config-expensify@latest -E`. This should update the `package.json` and `package-lock.json` file, and you can submit a PR with those changes.

**Note** as of now we have no way of testing these PRs without a separate App, Web or Web-Secure PR

## Usage

We export two ESLint configurations for your usage.

### eslint-config-expensify

Our default export contains all of our ESLint rules, including ECMAScript 6+ and React. It requires `eslint`, `eslint-plugin-import`, `eslint-plugin-react`, and `eslint-plugin-jsx-a11y`.

Just add `extends: 'expensify'` to the `.eslintrc` file in the root directory of your project.

### eslint-config-expensify/legacy

Just add `extends: 'expensify/legacy'` to the `.eslintrc` file in the root directory of your project.

### eslint-config-expensify/jest

Opt-in config for Jest test, mock, and setup files. Enables Jest globals, `eslint-plugin-jest` recommended and style rules, relaxes `no-console`, `no-await-in-loop`, and `no-import-assign` for test files, and allows the `@jest-environment` JSDoc tag via `jsdoc/check-tag-names`.

```js
import {defineConfig} from 'eslint/config';
import expensifyConfig from 'eslint-config-expensify';
import jestConfig from 'eslint-config-expensify/jest';

export default defineConfig([
    ...expensifyConfig,
    ...jestConfig,
]);
```

## oxlint

`eslint-config-expensify/oxlint` builds an [oxlint](https://oxc.rs) config from the same presets you would list in an ESLint config, so a repo can lint with oxlint without copying any rules. Rules oxlint can't run itself still run, from ESLint's own code, as `core/<rule>` (ESLint core rules) and `hosted/<rule>` (ESLint plugin rules).

Install oxlint next to this package. These are optional peer dependencies, so repos that only use the ESLint presets don't get them:

```sh
npm install --save-dev oxlint @oxlint/migrate oxlint-tsgolint
```

```js
// oxlint.config.mts
import {defineConfig} from 'oxlint';
import {buildOxlintConfig} from 'eslint-config-expensify/oxlint';

export default defineConfig(
    await buildOxlintConfig({
        presets: ['browser', 'react', 'typescript', {preset: 'jest', files: ['tests/**']}, 'scripts', 'prettier'],
        ignorePatterns: ['dist/**'],
        overrides: [{files: ['**/*.ts'], rules: {'core/no-restricted-syntax': ['error', {selector: 'TSEnumDeclaration', message: 'No enums.'}]}}],
    }),
);
```

Options:

- `presets`: this package's exports (`browser`, `react`, `typescript`, `jest`, `scripts`, ...) plus `'prettier'` to turn off formatting rules. `{preset, files}` limits a preset to some files.
- `ignorePatterns`, `env`, `globals`, `settings`, `jsPlugins`, `overrides`: the repo's own config, applied after the presets. A rule that runs as `core/` or `hosted/` must be written with that prefix; the build says so if it isn't.
- `plugins: {hosted, rulesdir}`: a repo's own plugin file in place of ours, for example to add rules or wrap one. Build it with `hostRule()` and the `rules` exported by `eslint-config-expensify/oxlint/plugins/hosted.mjs` and `.../rulesdir.mjs`.
- `transformRule(ruleID, entry)`: rename (`[newID, entry]`) or drop (`null`) a preset rule before it is converted.
- `nativeRules`: rules from `alwaysHostedRuleIDs` (like `react-hooks/exhaustive-deps`) to run with oxlint's faster version instead of ESLint's.
- `extraRunningNames`: rule names or prefixes (like `rc/`) that the repo's own plugins add.
- `withNursery`: also use oxlint's experimental (nursery) rules where it has them.
- `reactVersion`: only needed when `react` can't be found from the repo.

`toEslintRuleID()` turns oxlint's name for a finding, like `hosted(exhaustive-deps)`, back into the ESLint rule ID, so baselines and `eslint-disable` comments keep using ESLint IDs.

### Changing rules

Edit the presets as usual. If you add a rule, change `oxlint/tables.mjs` or move to another oxlint version, run `npm run build:oxlint` and commit what it changes: `oxlint/generated/rules.json` (which rules run as `core/` or `hosted/`) and the test snapshots. Run `npm run test:oxlint` to check the oxlint side; `npm test` doesn't include it.

## Style Guide

Feel free to also check out our [Javascript style guide](https://github.com/Expensify/Style-Guides/blob/main/javascript.md), our [general language-agnostic coding standards](https://github.com/Expensify/Style-Guides/blob/main/general.md), and the [ESlint config docs](http://eslint.org/docs/user-guide/configuring#extending-configuration-files) for more information.
