// Labelled control with an optional hint (always shown) and error (role="alert"); both are
// linked to the control with aria-describedby. `as` picks the control: "input" (default),
// "textarea" or "select" (pass <option> elements as children).
function FormField({ id, label, hint, error, as: Control = 'input', children, ...inputProps }) {
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
      <Control
        id={id}
        className="field-input"
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy}
        {...inputProps}
      >
        {children}
      </Control>
      {error && (
        <p className="field-error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export default FormField;
