/** The Aspire brand star motif, official artwork - stroke inherits `currentColor` via `text-*`. */
export function AspireMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 150 150" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <path
        d="M34.5502 134.091C33.9805 132.969 34.1584 129.501 34.5502 124.669C35.0401 118.631 44.0818 30.6114 68.218 18.1566C87.527 8.19266 106.051 60.0746 112.9 87.2611C116.756 98.7637 122.754 122.059 115.892 123.219C107.315 124.669 83.1785 120.407 56.0502 101.925C28.9219 83.444 11.9667 72.3954 19.3472 58.3334C26.7277 44.2715 114.097 37.6423 122.275 37.8432C130.453 38.0441 141.424 43.468 120.679 62.9538C104.083 78.5424 63.3641 110.593 45.0791 124.669"
        stroke="currentColor" strokeWidth="6" strokeLinecap="round"
      />
    </svg>
  );
}
