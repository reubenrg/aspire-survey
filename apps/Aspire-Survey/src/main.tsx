import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { ErrorBoundary } from 'react-error-boundary';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
// '/react', not '/next' — this is a Vite SPA, and the Next entry pulls in
// next/navigation hooks that do not exist here.
import { Analytics } from '@vercel/analytics/react';
import AppRouter from './AppRouter';

const queryClient = new QueryClient();

function RuntimeErrorFallback(props: { error: Error }) {
  return (
    <div className="fixed inset-0 grid place-items-center p-4">
      <div className="relative w-full max-w-xl rounded border-t-4 border-t-red-500 bg-white p-4 shadow-lg">
        <h3 className="mb-2 font-medium">Issue rendering the survey</h3>
        <p className="mb-4 text-sm text-gray-600">
          Something went wrong while loading this page. Try reloading. Your answers are only
          saved once you submit.
        </p>
        <pre className="overflow-auto rounded border-l-4 border-red-500 bg-red-50 p-4 font-mono text-sm text-red-900">
          {props.error.message}
        </pre>
        <button
          type="button"
          onClick={() => location.reload()}
          className="mt-4 rounded border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm font-medium text-gray-500 transition hover:bg-gray-100"
        >
          Reload
        </button>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary fallbackRender={props => <RuntimeErrorFallback error={props.error} />}>
      <QueryClientProvider client={queryClient}>
        <AppRouter />
      </QueryClientProvider>
    </ErrorBoundary>
    {/* Outside the boundary on purpose: a crash in the survey should still
        register the visit rather than disappearing from analytics. */}
    <Analytics />
  </StrictMode>,
);
