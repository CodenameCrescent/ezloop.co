export function Logo({ className = "" }: { className?: string }) {
  return (
    <div
      /* The brand orange, not the darker fill twin: this is the mark itself,
         and nothing sits on top of it that needs contrast. */
      className={`flex h-9 w-9 items-center justify-center text-[color:var(--pl-orange)] ${className}`}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 42 24"
        className="h-7 w-9"
        fill="none"
        role="img"
      >
        <path
          d="M11.2 18.4C6.9 18.4 3.5 15.5 3.5 12s3.4-6.4 7.7-6.4c3.1 0 5.7 1.6 8.2 4.5l1.6 1.9 1.6-1.9c2.5-2.9 5.1-4.5 8.2-4.5 4.3 0 7.7 2.9 7.7 6.4s-3.4 6.4-7.7 6.4c-3.1 0-5.7-1.6-8.2-4.5L21 12l-1.6 1.9c-2.5 2.9-5.1 4.5-8.2 4.5Z"
          stroke="currentColor"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
