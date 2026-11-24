import { configure } from '@testing-library/react';

// findBy*/waitFor give up after 1s by default. The first test in a file renders the whole
// app cold, which can take longer on a busy CI runner, so allow more time. Passing tests
// are not slowed down: the wait ends as soon as the element appears.
configure({ asyncUtilTimeout: 3000 });
