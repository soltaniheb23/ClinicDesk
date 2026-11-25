// Styles: .pagination and .button-secondary in tickets/tickets.css.
import '../tickets/tickets.css';

// Previous / "Page x of y" / Next below a paginated list.
function Pagination({ page, totalPages, onChange }) {
  return (
    <nav className="pagination" aria-label="Pagination">
      <button
        type="button"
        className="button-secondary"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        Previous
      </button>
      <span aria-live="polite">
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        className="button-secondary"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}

export default Pagination;
