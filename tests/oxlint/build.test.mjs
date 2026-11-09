import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

import {convertPresets} from '../../oxlint/convert.mjs';
import {
    buildOxlintConfig, hostRule, reactCompilerRuleNames, toEslintRuleID,
} from '../../oxlint/index.mjs';

/**
 * Runs `callback` with an empty temp folder as the working directory, so `react` cannot be resolved from it. Node also
 * looks in the folders above it, so this fails up front when the temp folder sits under a node_modules/react.
 * @param {() => Promise<void>} callback
 */
async function inEmptyDirectory(callback) {
    const cwd = process.cwd();
    const emptyDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'expensify-oxlint-empty-'));
    assert.throws(
        () => createRequire(path.join(emptyDirectory, 'index.js')).resolve('react'),
        `react resolves from ${emptyDirectory}, so this test cannot check what happens without it. Set TMPDIR to a folder with no node_modules/react above it.`,
    );
    process.chdir(emptyDirectory);
    try {
        await callback();
    } finally {
        process.chdir(cwd);
        fs.rmSync(emptyDirectory, {recursive: true, force: true});
    }
}

/** @returns {boolean} whether `react` resolves from this checkout, the second place buildOxlintConfig looks */
function canResolveReactFromPackage() {
    try {
        createRequire(fileURLToPath(import.meta.url)).resolve('react');
        return true;
    } catch {
        return false;
    }
}

const rulesOf = config => [config.rules, ...config.overrides.map(override => override.rules)];
const hasRule = (config, name) => rulesOf(config).some(rules => rules && name in rules);

test('React Compiler rules are kept as @oxlint/migrate writes them by default, and rules-of-hooks stays', async () => {
    // Given the react preset, which turns on React Compiler rules
    // When the config is built without a transformRule
    const config = await buildOxlintConfig({presets: ['react'], reactVersion: '19.0.0'});

    // Then the compiler rules are there under the native `react/` name, except the checks oxlint does not implement
    assert.ok(reactCompilerRuleNames.length > 10);
    assert.ok(hasRule(config, 'react/immutability') && hasRule(config, 'react/purity'));
    assert.ok(!hasRule(config, 'hosted/gating') && !hasRule(config, 'react/gating') && !hasRule(config, 'react/config'));
    assert.ok(hasRule(config, 'react/rules-of-hooks'));
    assert.ok(hasRule(config, 'hosted/exhaustive-deps'));
});

test('nativeRules runs an always-hosted rule with oxlint\'s version, and rejects other IDs', async () => {
    // Given the react preset, whose exhaustive-deps options are the ones both versions must get
    const presets = ['react'];
    const reactVersion = '19.0.0';
    const optionsOf = (config, name) => rulesOf(config).map(rules => rules?.[name]).find(Boolean);

    // When the config is built with and without nativeRules
    const hosted = await buildOxlintConfig({presets, reactVersion});
    const native = await buildOxlintConfig({presets, reactVersion, nativeRules: ['react-hooks/exhaustive-deps']});

    // Then the default hosts it, and the opt-in runs the native rule with the same options and no hosted copy
    assert.ok(hasRule(hosted, 'hosted/exhaustive-deps') && !hasRule(hosted, 'react/exhaustive-deps'));
    assert.ok(hasRule(native, 'react/exhaustive-deps') && !hasRule(native, 'hosted/exhaustive-deps'));
    assert.deepEqual(optionsOf(native, 'react/exhaustive-deps'), optionsOf(hosted, 'hosted/exhaustive-deps'));

    // And an overrides entry may use the native name, while an ID that is not always hosted throws
    await buildOxlintConfig({
        presets, reactVersion, nativeRules: ['react-hooks/exhaustive-deps'], overrides: [{files: ['**/*.js'], rules: {'react/exhaustive-deps': 'off'}}],
    });
    await assert.rejects(buildOxlintConfig({presets, reactVersion, nativeRules: ['no-console']}), /nativeRules has no-console/);
});

test('with nativeRules, the native name of a rule is accepted and its hosted/ name is refused', async () => {
    // Given every always-hosted rule run natively
    const nativeRules = ['import/prefer-default-export', 'react/function-component-definition', 'react/jsx-no-constructed-context-values', 'react-hooks/exhaustive-deps'];
    const build = rule => buildOxlintConfig({
        presets: ['react'], reactVersion: '19.0.0', nativeRules, overrides: [{files: ['**/*.js'], rules: {[rule]: 'off'}}],
    });

    // When an override names each rule as oxlint does, then it is accepted
    for (const rule of [...nativeRules, 'react/exhaustive-deps']) {
        await build(rule);
    }

    // And the hosted/ name, which would do nothing, is refused with the name to use
    await assert.rejects(build('hosted/prefer-default-export'), /runs as "import\/prefer-default-export"/);
    await assert.rejects(build('hosted/exhaustive-deps'), /runs as "react\/exhaustive-deps"/);
});

test('transformRule can rename or drop a rule', async () => {
    // Given a transformRule that sends compiler rules to `rc/` and drops no-console
    const transformRule = (ruleID, entry) => {
        if (ruleID.startsWith('react-hooks/') && reactCompilerRuleNames.includes(ruleID.slice('react-hooks/'.length))) {
            return [`rc/${ruleID.slice('react-hooks/'.length)}`, entry];
        }
        return ruleID === 'no-console' ? null : undefined;
    };

    // When the config is built
    const config = await buildOxlintConfig({presets: ['browser', 'react'], transformRule, reactVersion: '19.0.0'});

    // Then compiler rules are written under the new name and no-console is gone
    assert.ok(hasRule(config, 'rc/immutability'));
    assert.ok(!hasRule(config, 'no-console'));
});

test('an unknown react-hooks rule fails the conversion', async () => {
    // Given a preset block with a react-hooks rule that is neither a compiler rule nor classic
    const blocks = [{rules: {'react-hooks/made-up-rule': 'error'}}];

    // When it is converted, then it fails loudly instead of running a rule nobody checked
    await assert.rejects(convertPresets(blocks), /not a known React Compiler rule/);
});

test('buildOxlintConfig points at the plugin files with absolute paths, and plugins can be replaced', async () => {
    // Given a repo with its own hosted plugin
    // When the config is built
    const config = await buildOxlintConfig({presets: ['browser', 'react', 'expensify'], plugins: {hosted: '/repo/hosted.mjs'}, reactVersion: '19.0.0'});

    // Then every plugin of the package has an absolute path and the repo's replaces `hosted`
    const specifiers = Object.fromEntries(config.jsPlugins.map(plugin => [plugin.name, plugin.specifier]));
    assert.equal(specifiers.hosted, '/repo/hosted.mjs');
    assert.ok(specifiers.core.startsWith('/') && specifiers.core.endsWith('oxlint/plugins/core.mjs'));
    assert.ok(specifiers.rulesdir.startsWith('/') && specifiers.rulesdir.endsWith('oxlint/plugins/rulesdir.mjs'));
});

test('overrides that use the wrong name for a hosted or core rule are rejected', async () => {
    // Given overrides that set a rule by oxlint's name while it runs hosted, core, or under a name no plugin has
    const build = (rule, extraRunningNames) => buildOxlintConfig({
        presets: ['react'], reactVersion: '19.0.0', overrides: [{files: ['**/*.js'], rules: {[rule]: 'off'}}], extraRunningNames,
    });

    // When the config is built, then each one fails with the name to use
    await assert.rejects(build('import/prefer-default-export'), /Use that name instead/);
    await assert.rejects(build('no-restricted-syntax'), /runs as "core\/no-restricted-syntax"/);
    await assert.rejects(build('react/exhaustive-deps'), /runs as "hosted\/exhaustive-deps"/);
    await assert.rejects(build('hosted/not-a-rule'), /npm run build:oxlint/);

    // And the repo's own rules pass when they are named in extraRunningNames
    await build('hosted/not-a-rule', ['hosted/not-a-rule']);
    await build('rc/immutability', ['rc/']);
});

test('buildOxlintConfig needs a React version when the react preset is used and react cannot be resolved', async (t) => {
    // buildOxlintConfig also looks for react from where this package sits, so a checkout inside a project with react
    // finds it and this case cannot happen there. CI checks out the package on its own.
    if (canResolveReactFromPackage()) {
        t.skip('react resolves from this checkout\'s location');
        return;
    }

    // Given an empty working directory where react cannot be resolved
    await inEmptyDirectory(async () => {
        // When the react preset is built without reactVersion, then it fails clearly
        await assert.rejects(buildOxlintConfig({presets: ['react']}), /pass `reactVersion`/);

        // And presets without react do not need one
        await buildOxlintConfig({presets: ['expensify']});
    });
});

test('settings.react.version is accepted as the React version', async () => {
    // Given an empty working directory, where react cannot be resolved
    await inEmptyDirectory(async () => {
        // When the react preset is built with the version only in settings
        const config = await buildOxlintConfig({presets: ['react'], settings: {react: {version: '18.2.0'}}});

        // Then it is used
        assert.equal(config.settings.react.version, '18.2.0');
    });
});

test('withNursery is an option, off by default', async () => {
    // Given the same presets
    // When they are built with and without nursery rules
    const without = await buildOxlintConfig({presets: ['browser'], reactVersion: '19.0.0'});
    const withNursery = await buildOxlintConfig({presets: ['browser'], withNursery: true, reactVersion: '19.0.0'});

    // Then a nursery rule runs as core/ from ESLint's code by default, and natively with the option
    assert.ok(hasRule(without, 'core/no-undef') && !hasRule(without, 'no-undef'));
    assert.ok(hasRule(withNursery, 'no-undef') && !hasRule(withNursery, 'core/no-undef'));
});

test('a re-scoped typescript preset still gets the TypeScript no-unused-vars option', async () => {
    // Given the typescript preset limited to a folder, which no TypeScript glob matches
    // When the config is built
    const config = await buildOxlintConfig({presets: [{preset: 'typescript', files: ['src/**']}], reactVersion: '19.0.0'});

    // Then no-unused-vars reports variables only used as types, as typescript-eslint's rule does
    const rule = config.overrides.map(override => override.rules?.['no-unused-vars']).find(Boolean);
    assert.equal(rule?.[1]?.reportVarsOnlyUsedAsTypes, true, JSON.stringify(rule));
});

test('rules renamed by transformRule keep the order checks of other rules', async () => {
    // Given a preset where a rule is set for TypeScript files, then for all files
    const rename = (ruleID, entry) => (ruleID === 'react-hooks/immutability' ? ['rc/immutability', entry] : undefined);
    const scopedThenUnscoped = [
        {files: ['**/*.ts'], rules: {'react-hooks/immutability': 'error'}},
        {rules: {'react-hooks/immutability': 'off'}},
    ];

    // When it is converted, then the clash is refused as for any other rule
    await assert.rejects(convertPresets(scopedThenUnscoped, {transformRule: rename}), /unscoped preset block after a scoped one sets rc\/immutability/);

    // Given a preset that sets options for all files, then only a severity for some
    const optionsThenSeverity = [
        {rules: {'react-hooks/immutability': ['error', {strict: true}]}},
        {files: ['**/*.ts'], rules: {'react-hooks/immutability': 'warn'}},
    ];

    // When it is converted
    const {config} = await convertPresets(optionsThenSeverity, {transformRule: rename});

    // Then the later block keeps the options of the earlier one, as in ESLint
    assert.deepEqual(config.rules['rc/immutability'], ['error', {strict: true}]);
    assert.deepEqual(config.overrides.find(override => override.rules['rc/immutability']).rules['rc/immutability'], ['warn', {strict: true}]);
});

test('hostRule hosts a rule of a plugin the package does not list, and eslint-disable comments with its ESLint ID hide its reports', async () => {
    // Given a plugin the package does not list, with a rule that reports on the program node
    const rule = {meta: {}, create: context => ({Program: node => context.report({node, message: 'reported'})})};
    const reportsOf = (hostedRule) => {
        const reports = [];
        const comment = {type: 'Line', value: ' eslint-disable-next-line storybook/default-exports', loc: {start: {line: 1, column: 0}, end: {line: 1, column: 50}}};
        const context = {filename: 'hosted-rule.js', sourceCode: {getAllComments: () => [comment]}, report: report => reports.push(report)};
        hostedRule.create(context).Program({loc: {start: {line: 2, column: 0}, end: {line: 2, column: 5}}});
        return reports;
    };

    // When one of its rules is hosted
    const hosted = hostRule('storybook/default-exports', {'default-exports': rule});

    // Then the comment that names the ESLint ID hides the report, which the raw rule does not do
    assert.equal(reportsOf(rule).length, 1);
    assert.equal(reportsOf(hosted).length, 0);

    // And a missing rule fails clearly
    assert.throws(() => hostRule('storybook/missing', {'default-exports': rule}), /no rule named "missing"/);
});

test('repo options are merged after the presets', async () => {
    // Given the react preset and a repo that sets every option it can add
    const own = {name: 'mine', specifier: '/repo/mine.mjs'};
    const override = {files: ['**/*.ts'], rules: {eqeqeq: 'off'}};

    // When the config is built, next to one built without the repo's options
    const presets = ['browser', 'react'];
    const base = await buildOxlintConfig({presets, reactVersion: '19.0.0'});
    const config = await buildOxlintConfig({
        presets,
        reactVersion: '19.0.0',
        ignorePatterns: ['dist/**'],
        env: {myEnv: true},
        globals: {MY_GLOBAL: 'readonly'},
        settings: {react: {linkComponents: ['Link']}, mine: {a: 1}},
        jsPlugins: [own],
        overrides: [override],
    });

    // Then the repo's parts come after the presets', and settings merge key by key instead of replacing the preset's
    assert.deepEqual(config.ignorePatterns, [...base.ignorePatterns, 'dist/**']);
    assert.deepEqual(config.env, {...base.env, myEnv: true});
    assert.deepEqual(config.globals, {...base.globals, MY_GLOBAL: 'readonly'});
    assert.deepEqual(config.settings, {...base.settings, react: {...base.settings.react, linkComponents: ['Link']}, mine: {a: 1}});
    assert.equal(config.settings.react.version, '19.0.0');
    assert.deepEqual(config.jsPlugins, [...base.jsPlugins, own]);
    assert.deepEqual(config.overrides, [...base.overrides, override]);
});

test('a rules.json that lacks a rule the conversion needs fails with the build:oxlint hint', async () => {
    // Given a rule written under a core/ name that generated/rules.json does not list, like a stale file would be
    const transformRule = ruleID => (ruleID === 'no-console' ? ['core/not-in-rules-json', 'error'] : undefined);

    // When the config is built, then it fails and says how to refresh the file
    await assert.rejects(buildOxlintConfig({presets: ['browser'], transformRule}), /core\/not-in-rules-json, which generated\/rules.json does not list\. Run npm run build:oxlint/);
});

test('buildOxlintConfig rejects unknown options and unknown presets', async () => {
    // Given a typo in an option and in a preset name
    // When the config is built, then it fails with a clear message
    await assert.rejects(buildOxlintConfig({presets: ['react'], reactVersion: '19.0.0', ignorePattern: []}), /does not know the option ignorePattern/);
    await assert.rejects(buildOxlintConfig({presets: ['reakt']}), /Unknown preset "reakt"/);
});

test('with withNursery, the names of the rules oxlint runs itself are accepted, and without it they are refused', async () => {
    // Given an override that sets nursery rules by their ESLint names
    const build = (rule, withNursery) => buildOxlintConfig({presets: ['browser'], withNursery, overrides: [{files: ['**/*.js'], rules: {[rule]: 'off'}}]});

    // When the config is built without nursery rules, then the rule runs as core/ and the name is refused
    await assert.rejects(build('no-undef', false), /runs as "core\/no-undef"/);

    // And with nursery rules oxlint runs it itself, so its own name is accepted
    await build('no-undef', true);
    await build('import/export', true);
});

test('re-scoping the browser and node presets builds', async () => {
    // Given presets limited to some files, which changes which rules oxlint skips
    // When the config is built, then it does not ask for npm run build:oxlint
    await buildOxlintConfig({presets: [{preset: 'browser', files: ['src/**']}], reactVersion: '19.0.0'});
    await buildOxlintConfig({presets: [{preset: 'node', files: ['scripts/**']}], reactVersion: '19.0.0'});
});

test('extraRunningNames cannot hold core/ names', async () => {
    // Given a repo that lists a core/ rule as its own
    // When the config is built, then it is refused, because the core plugin cannot be replaced
    await assert.rejects(buildOxlintConfig({presets: ['browser'], extraRunningNames: ['core/my-rule']}), /extraRunningNames has core\/my-rule/);
    await assert.rejects(buildOxlintConfig({presets: ['browser'], extraRunningNames: ['core/']}), /extraRunningNames has core\//);
});

test('rules renamed by transformRule still get the option fixes oxlint needs', async () => {
    // Given a preset rule that oxlint's version takes no options for, kept under its own name by transformRule
    const keep = (ruleID, entry) => (ruleID === 'react/jsx-no-undef' ? [ruleID, entry] : undefined);
    const options = ['error', {allowGlobals: true}];

    // When it is converted for all files and for some
    const {config} = await convertPresets([{rules: {'react/jsx-no-undef': options}}, {files: ['**/*.ts'], rules: {'react/jsx-no-undef': options}}], {transformRule: keep});

    // Then oxlint gets the severity only, in the root and in the override
    assert.equal(config.rules['react/jsx-no-undef'], 'error');
    assert.equal(config.overrides.find(override => override.rules['react/jsx-no-undef']).rules['react/jsx-no-undef'], 'error');
});

test('preset entries are checked', async () => {
    // Given entries that are not a name or {preset, files}
    // When the config is built, then each fails with a message about the entry
    await assert.rejects(buildOxlintConfig({presets: [{name: 'jest'}]}), /name or \{preset, files\}/);
    await assert.rejects(buildOxlintConfig({presets: [{preset: 'jest', files: 'tests/**'}]}), /files of the "jest" preset must be a non-empty array of strings/);
    await assert.rejects(buildOxlintConfig({presets: [{preset: 'jest', files: []}]}), /non-empty array of strings/);
    await assert.rejects(buildOxlintConfig({presets: [{preset: 'jest', files: [1]}]}), /non-empty array of strings/);

    // And an unknown name lists the valid ones
    await assert.rejects(buildOxlintConfig({presets: ['reakt']}), /Unknown preset "reakt"\. Use one of: browser, .*react.*prettier/);
});

test('the rulesdir plugin leaves out the rules that need type information', async () => {
    // Given the rules of eslint-plugin-expensify that ask for TypeScript parser services, which oxlint JS plugins lack
    const directory = fileURLToPath(new URL('../../eslint-plugin-expensify/', import.meta.url));
    const needTypes = fs.readdirSync(directory)
        .filter(file => file.endsWith('.js') && fs.readFileSync(path.join(directory, file), 'utf8').includes('getParserServices'))
        .map(file => file.slice(0, -3));

    // When the plugin is loaded
    const {rules} = await import('../../oxlint/plugins/rulesdir.mjs');

    // Then those rules are not in it, because they would throw on every file, and the others are
    assert.ok(needTypes.length >= 3, needTypes.join(', '));
    assert.deepEqual(needTypes.filter(name => name in rules), []);
    assert.ok('no-inline-named-export' in rules);
});

test('the core and hosted plugins load only when the config uses one of their rules', async () => {
    // Given presets that turn off every rule that runs from ESLint's code
    const pluginNames = config => config.jsPlugins.map(plugin => plugin.name);
    const prettierOnly = await buildOxlintConfig({presets: ['prettier']});

    // When a repo adds a core/ rule, or a hosted/ rule next to its own hosted plugin
    const withCore = await buildOxlintConfig({presets: ['prettier'], overrides: [{files: ['**/*.js'], rules: {'core/no-restricted-syntax': 'error'}}]});
    const withHosted = await buildOxlintConfig({
        presets: ['prettier'], plugins: {hosted: '/repo/hosted.mjs'}, overrides: [{files: ['**/*.js'], rules: {'hosted/exhaustive-deps': 'error'}}],
    });

    // Then each plugin is there only for the rules that use it
    assert.deepEqual(pluginNames(prettierOnly).filter(name => ['core', 'hosted'].includes(name)), []);
    assert.deepEqual(pluginNames(withCore).filter(name => ['core', 'hosted'].includes(name)), ['core']);
    assert.deepEqual(withHosted.jsPlugins.filter(plugin => ['core', 'hosted'].includes(plugin.name)), [{name: 'hosted', specifier: '/repo/hosted.mjs'}]);
});

test('a plugin whose rules are only turned off is not loaded, and those off entries are dropped', async () => {
    // Given presets that only turn rulesdir rules off (no expensify preset), and a repo that only turns a core/ rule off
    const rulesdirOff = await buildOxlintConfig({presets: ['browser', 'typescript']});
    const coreOff = await buildOxlintConfig({presets: ['prettier'], overrides: [{files: ['**/*.js'], rules: {'core/no-restricted-syntax': 'off'}}]});

    // When the rule names of each built config are collected
    const ruleNames = config => [config.rules, ...config.overrides.map(override => override.rules ?? {})].flatMap(rules => Object.keys(rules));

    // Then the plugin is not loaded and no rule names it, since oxlint rejects a rule whose plugin is missing
    assert.deepEqual(rulesdirOff.jsPlugins.filter(plugin => plugin.name === 'rulesdir'), []);
    assert.deepEqual(ruleNames(rulesdirOff).filter(rule => rule.startsWith('rulesdir/')), []);
    assert.deepEqual(coreOff.jsPlugins.filter(plugin => plugin.name === 'core'), []);
    assert.deepEqual(ruleNames(coreOff).filter(rule => rule.startsWith('core/')), []);
});

test('toEslintRuleID maps oxlint names back to ESLint rule IDs', () => {
    // Given oxlint diagnostic codes
    // When they are mapped, then ESLint's IDs come back
    assert.equal(toEslintRuleID('typescript(no-explicit-any)'), '@typescript-eslint/no-explicit-any');
    assert.equal(toEslintRuleID('hosted(prefer-default-export)'), 'import/prefer-default-export');
    assert.equal(toEslintRuleID('hosted(exhaustive-deps)'), 'react-hooks/exhaustive-deps');
    assert.equal(toEslintRuleID('core(dot-notation)'), 'dot-notation');
    assert.equal(toEslintRuleID('eslint(no-object-constructor)'), 'no-new-object');
    assert.equal(toEslintRuleID('jsx_a11y(alt-text)'), 'jsx-a11y/alt-text');
    assert.equal(toEslintRuleID('rc(immutability)', {pluginPrefixes: {rc: 'react-hooks'}}), 'react-hooks/immutability');
    assert.equal(toEslintRuleID('hosted(require-jsdoc)', {hostedRules: {'require-jsdoc': 'jsdoc/require-jsdoc'}}), 'jsdoc/require-jsdoc');
    assert.throws(() => toEslintRuleID('hosted(unknown-rule)'), /no ESLint ID/);
});
