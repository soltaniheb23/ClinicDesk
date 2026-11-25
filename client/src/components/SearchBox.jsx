import { useEffect, useEffectEvent, useState } from 'react';
import FormField from './FormField.jsx';

export const SEARCH_DEBOUNCE_MS = 300;

// Search field for list toolbars: typing calls onCommit after a short pause (Enter applies
// it at once). The box follows `value` when it changes from outside (back button,
// "Clear filters").
function SearchBox({ id, label, value, maxLength, onCommit, debounceMs = SEARCH_DEBOUNCE_MS }) {
  const [draft, setDraft] = useState(value);
  const [syncedValue, setSyncedValue] = useState(value);
  const commit = useEffectEvent(onCommit);

  if (value !== syncedValue) {
    setSyncedValue(value);
    setDraft(value);
  }

  useEffect(() => {
    if (draft === value) return undefined;
    const timer = setTimeout(() => commit(draft), debounceMs);
    return () => clearTimeout(timer);
  }, [draft, value, debounceMs]);

  return (
    <FormField
      id={id}
      type="search"
      label={label}
      maxLength={maxLength}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          if (draft !== value) onCommit(draft);
        }
      }}
    />
  );
}

export default SearchBox;
