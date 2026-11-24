// Ticket enums from the API (server/src/models/Ticket.js) with their display labels.
export const CATEGORY_OPTIONS = [
  { value: 'it', label: 'IT' },
  { value: 'facility', label: 'Facility' },
  { value: 'account', label: 'Account' },
  { value: 'other', label: 'Other' },
];

export const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

export const STATUS_LABELS = {
  open: 'Open',
  in_progress: 'In progress',
  waiting: 'Waiting',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const TITLE_MAX_LENGTH = 120;
export const DESCRIPTION_MAX_LENGTH = 5000;

export function labelFor(options, value) {
  return options.find((option) => option.value === value)?.label ?? value;
}

export function validateTicket({ title, description, category, priority }) {
  const errors = {};
  const trimmedTitle = title.trim();
  const trimmedDescription = description.trim();

  if (!trimmedTitle) errors.title = 'Title is required';
  else if (trimmedTitle.length > TITLE_MAX_LENGTH) {
    errors.title = `Title must be at most ${TITLE_MAX_LENGTH} characters`;
  }

  if (!trimmedDescription) errors.description = 'Description is required';
  else if (trimmedDescription.length > DESCRIPTION_MAX_LENGTH) {
    errors.description = `Description must be at most ${DESCRIPTION_MAX_LENGTH} characters`;
  }

  if (!CATEGORY_OPTIONS.some((option) => option.value === category)) {
    errors.category = 'Choose a valid category';
  }
  if (!PRIORITY_OPTIONS.some((option) => option.value === priority)) {
    errors.priority = 'Choose a valid priority';
  }

  return errors;
}
