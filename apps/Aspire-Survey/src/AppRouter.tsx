import { BrowserRouter, Route, Routes } from 'react-router-dom';
import App from './App';
import SurveyPage from './routes/SurveyPage';

/**
 * `/` stays the original hand-written S2M survey, deliberately: it is live and
 * circulating, so it keeps its own code path rather than being migrated onto
 * the engine. Everything built in the admin lives under /s/:slug.
 */
export default function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/s/:slug" element={<SurveyPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}

function NotFound() {
  return (
    <div className="min-h-screen grid place-items-center bg-background px-6">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-display text-foreground mb-2">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          Survey links look like <code className="font-mono">/s/your-survey-name</code>.
        </p>
      </div>
    </div>
  );
}
