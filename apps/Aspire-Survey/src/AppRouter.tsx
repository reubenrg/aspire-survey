import { BrowserRouter, Route, Routes } from 'react-router-dom';
import App from './App';
import SurveyPage from './routes/SurveyPage';
import InvitePage from './routes/InvitePage';
import AdminGate from './admin/AdminGate';
import AdminShell from './admin/AdminShell';
import Overview from './admin/pages/Overview';
import Customers from './admin/pages/Customers';
import ComingSoon from './admin/pages/ComingSoon';
import SurveyManagement from './admin/pages/SurveyManagement';
import SurveyDetail from './admin/pages/SurveyDetail';
import SurveyBuilder from './admin/pages/SurveyBuilder';
import CreateSurvey from './admin/pages/CreateSurvey';
import SurveyAudience from './admin/pages/SurveyAudience';
import CustomerEmployees from './admin/pages/CustomerEmployees';
import { AdminEditor } from './routes/AdminPages';
import ReportPage from './admin/ReportPage';

/**
 * `/` stays the original hand-written S2M survey, deliberately: it is live,
 * frozen and respondent-facing, so it keeps its own code path rather than being
 * migrated onto the engine. Everything the admin builds lives at /s/:slug.
 */
export default function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/s/:slug" element={<SurveyPage />} />
        <Route path="/r/:token" element={<InvitePage />} />

        {/*
          The Builder gets the full viewport and its own chrome (a compact top
          bar, not the sidebar), so it sits outside AdminShell entirely rather
          than as a child route - a survey editor benefits from every pixel of
          width the three panes can get.
        */}
        <Route path="/admin/surveys/:slug/builder" element={<AdminGate><SurveyBuilder /></AdminGate>} />

        <Route path="/admin" element={<AdminGate><AdminShell /></AdminGate>}>
          <Route index element={<Overview />} />
          <Route path="customers" element={<Customers />} />
          <Route path="customers/:customerId/employees" element={<CustomerEmployees />} />
          <Route path="surveys" element={<SurveyManagement />} />
          <Route path="surveys/new" element={<CreateSurvey />} />
          <Route path="surveys/:slug" element={<SurveyDetail />} />
          <Route path="surveys/:slug/audience" element={<SurveyAudience />} />
          <Route path="responses" element={
            <ComingSoon
              title="Responses"
              summary="Browse, filter and export responses across surveys."
              whereForNow="Per-survey responses and CSV export are available today from a survey's Results screen."
              to="/admin/surveys"
            />} />
          <Route path="analytics" element={
            <ComingSoon
              title="Analytics"
              summary="Cross-survey analysis and question-level breakdowns."
              whereForNow="Per-survey analytics are available today from a survey's Results screen."
              to="/admin/surveys"
            />} />
          <Route path="library" element={
            <ComingSoon
              title="Question Library"
              summary="Reusable Aspire questions, categorised and tagged."
              whereForNow="Questions are currently authored per survey in the builder."
            />} />
          <Route path="team" element={
            <ComingSoon
              title="Team"
              summary="Who has access to which customer, and at what role."
              whereForNow="Roles are enforced in the database and are managed there for now. The screen to manage them is not built."
            />} />
          <Route path="activity" element={
            <ComingSoon
              title="Activity"
              summary="Audit trail of administrative actions."
              whereForNow="Recent activity appears on the Overview, and the full log is on a survey's Results screen under Audit."
              to="/admin"
            />} />
          <Route path="settings" element={
            <ComingSoon
              title="Settings"
              summary="Workspace defaults, branding and data policy."
              whereForNow="No settings are configurable from the admin yet."
            />} />

          {/* Survey-scoped screens keep their existing paths so links still work. */}
          <Route path=":slug" element={<AdminEditor />} />
          <Route path=":slug/report" element={<ReportPage />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}

function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center bg-background px-6">
      <div className="max-w-md text-center">
        <h1 className="mb-2 font-display text-xl text-foreground">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          Survey links look like <code className="font-mono">/s/your-survey-name</code>.
        </p>
      </div>
    </div>
  );
}
