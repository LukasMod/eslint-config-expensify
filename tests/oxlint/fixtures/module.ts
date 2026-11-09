// Each line below is there to trigger the rule named in its comment; the tests check that those rules report.
// import(newline-after-import): no empty line after the import
import {useEffect} from 'react';
const value: Record<string, string> = {};

// rulesdir(no-inline-named-export) and hosted(prefer-default-export): a single named export, declared inline
export function f() {
    // react-hooks(rules-of-hooks): `f` is neither a component nor a hook. typescript(no-unsafe-call): react cannot be resolved here, so `useEffect` has an error type
    // eslint(no-console): console.log. hosted(exhaustive-deps): `value.b` is listed as a dependency but never used
    useEffect(() => { console.log(value.a); }, [value.b]);

    // typescript(dot-notation): `value['a']` should be `value.a`
    return value['a'];
}
