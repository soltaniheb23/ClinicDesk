// Labelled input with an optional hint (always shown) and error (role="alert"); both are
// linked to the input with aria-describedby.
function FormField({ id, label, hint, error, ...inputProps }) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {hint && (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      )}
      <input
        id={id}
        className="field-input"
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy}
        {...inputProps}
      />
      {error && (
        <p className="field-error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export default FormField;
