# Client testing notes

The client tests use Vitest, jsdom and Testing Library (`cd client && npm test`). CI runs
`npm ci`, `npm run lint`, `npm test` and `npm run build` in `client/` on Node 26.

## Focus management

**Rule:** when focus moves because of an update that can follow an `await` (a save the
server refused, a request that came back, a control re-mounted after a save), move it in a
`useLayoutEffect`, or call `.focus()` directly in the handler on an element that is already
rendered. Do not move it in a passive `useEffect`.

**Why:** React runs a passive effect at once only when a click or a key press caused the
render. After an `await` the update has normal priority, and React runs the passive effect
in a later task. In that gap the old element is gone and focus is on `<body>`. A
screen-reader user loses their place, and a test can see the new content (for example
`findByRole('alert')`) before focus has moved. That test then fails only now and then,
mostly on a busy CI runner. A layout effect runs in the same commit as the DOM change, so
focus is in place when the new content appears.

This caused two CI failures on the users page. Both are fixed in
`client/src/users/UserControls.jsx`:

- PR #35: `useFocusOnMount`, focus on a control re-mounted after a successful save.
- CD-47 (CI run #73): `ActiveControl`, focus back on the Deactivate/Reactivate button
  after a refused save.

A passive effect is still fine for focus that only follows a click, such as
`CreateUserForm` focusing its first field when **New user** opens it.

**In tests:** check focus right after the content appears, with no `waitFor` around the
focus check. A `waitFor` would hide the gap a user can hit.

### Checking a suspected flake

One green run proves little. Run the file many times in a random order:

```bash
cd client
fails=0
for i in $(seq 1 40); do
  npx vitest run src/pages/UsersPage.test.jsx --sequence.shuffle > /dev/null 2>&1 || fails=$((fails+1))
done
echo "$fails/40 failed"
```

A fast machine can pass all 40. CI runners are slower and shared. If the loop stays green
but CI does not, run the same loop 4 at a time to add CPU load:

```bash
seq 1 40 | xargs -P 4 -I{} sh -c \
  'npx vitest run src/pages/UsersPage.test.jsx --sequence.shuffle > /tmp/run{}.log 2>&1 || echo "run {} failed"'
```

Do not run so many at once that tests hit the 5 s timeout. That causes different failures
that say nothing about the race. Before CD-47 the loaded loop failed 2 runs out of 40 with
focus on `<body>`. After the fix it failed 0 out of 120.
