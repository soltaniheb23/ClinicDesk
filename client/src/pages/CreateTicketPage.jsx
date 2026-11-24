import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createTicket } from '../api/index.js';
import FormField from '../components/FormField.jsx';
import {
  CATEGORY_OPTIONS,
  DESCRIPTION_MAX_LENGTH,
  PRIORITY_OPTIONS,
  TITLE_MAX_LENGTH,
  validateTicket,
} from '../tickets/options.js';
import '../components/forms.css';
import '../tickets/tickets.css';
import { focusFirstInvalid } from './authRedirect.js';

const FIELDS = ['title', 'description', 'category', 'priority'];

// Maps an API error to per-field errors (details[].field) and a form-level message.
function ticketErrors(error) {
  const fieldErrors = {};
  for (const detail of error.details ?? []) {
    if (FIELDS.includes(detail.field) && !fieldErrors[detail.field]) {
      fieldErrors[detail.field] = detail.message;
    }
  }
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;
  return { fieldErrors, formError: hasFieldErrors ? '' : error.message };
}

// Wireframe 04-create-ticket. File upload comes with the attachments ticket.
function CreateTicketPage() {
  const navigate = useNavigate();
  const [values, setValues] = useState({
    title: '',
    description: '',
    category: 'it',
    priority: 'normal',
  });
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function handleChange(event) {
    const { name, value } = event.target;
    setValues((previous) => ({ ...previous, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;

    const errors = validateTicket(values);
    setFieldErrors(errors);
    setFormError('');
    if (Object.keys(errors).length > 0) {
      focusFirstInvalid('ticket', FIELDS, errors);
      return;
    }

    setSubmitting(true);
    try {
      const { ticket } = await createTicket({
        title: values.title.trim(),
        description: values.description.trim(),
        category: values.category,
        priority: values.priority,
      });
      navigate('/tickets', { state: { createdTitle: ticket.title } });
    } catch (error) {
      const mapped = ticketErrors(error);
      setFieldErrors(mapped.fieldErrors);
      setFormError(mapped.formError);
      setSubmitting(false);
      focusFirstInvalid('ticket', FIELDS, mapped.fieldErrors);
    }
  }

  return (
    <section>
      <h1 className="page-title">New ticket</h1>
      <form
        className="form ticket-form"
        aria-label="New ticket"
        aria-describedby={formError ? 'ticket-form-error' : undefined}
        noValidate
        onSubmit={handleSubmit}
      >
        <FormField
          id="ticket-title"
          name="title"
          label="Title"
          hint={`Required, up to ${TITLE_MAX_LENGTH} characters`}
          required
          maxLength={TITLE_MAX_LENGTH}
          value={values.title}
          onChange={handleChange}
          error={fieldErrors.title}
        />
        <FormField
          id="ticket-description"
          name="description"
          as="textarea"
          label="Description"
          hint="What happened, where, and since when?"
          required
          rows={6}
          maxLength={DESCRIPTION_MAX_LENGTH}
          value={values.description}
          onChange={handleChange}
          error={fieldErrors.description}
        />
        <div className="field-row">
          <FormField
            id="ticket-category"
            name="category"
            as="select"
            label="Category"
            value={values.category}
            onChange={handleChange}
            error={fieldErrors.category}
          >
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </FormField>
          <FormField
            id="ticket-priority"
            name="priority"
            as="select"
            label="Priority"
            value={values.priority}
            onChange={handleChange}
            error={fieldErrors.priority}
          >
            {PRIORITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </FormField>
        </div>
        {formError && (
          <p className="form-error" id="ticket-form-error" role="alert">
            {formError}
          </p>
        )}
        <div className="form-actions">
          <button
            type="submit"
            className="button-primary"
            disabled={submitting}
            aria-busy={submitting}
          >
            {submitting ? 'Submitting...' : 'Submit'}
          </button>
          <Link className="button-secondary" to="/tickets">
            Cancel
          </Link>
        </div>
      </form>
    </section>
  );
}

export default CreateTicketPage;
