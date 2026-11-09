// Each line below is there to trigger the rule named in its comment; the tests check that those rules report.
import React from 'react';
import Foo from './foo';

const a = 1;
function Comp() {
    const x = {};

    // eslint(eqeqeq): `==` instead of `===`
    return <Foo bar={x} onClick={() => a == 1} />;
}
export default Comp;
