// Sends the shared 400 format: { error: { code, message, details: [{ field, message }] } }.
function validationError(response, zodError) {
  return response.status(400).json({
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Some fields are invalid',
      details: zodError.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    },
  });
}

module.exports = { validationError };
