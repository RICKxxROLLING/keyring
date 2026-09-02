// web/routes.tsx — route table (owner T4). Paths pinned by design §C10.2; T3's server-generated
// `url` fields on Notification/AttentionItem/SearchHit/TimelineEvent assume these exactly.
import { Navigate, Route, Routes } from "react-router-dom";
import { AuthenticatedShell } from "./components/AuthenticatedShell";
import { RequireAuth, RequireOwner } from "./components/RequireAuth";
import { LoginPage } from "./pages/LoginPage";
import { SetupPage } from "./pages/SetupPage";
import { InvitePage } from "./pages/InvitePage";
import { DashboardPage } from "./pages/DashboardPage";
import { DossierPage } from "./pages/DossierPage";
import { OverviewTab } from "./pages/dossier/OverviewTab";
import { NotesTab } from "./pages/dossier/NotesTab";
import { MaintenanceTab } from "./pages/dossier/MaintenanceTab";
import { DealTab } from "./pages/dossier/DealTab";
import { RenovationTab } from "./pages/dossier/RenovationTab";
import { DiscussionTab } from "./pages/dossier/DiscussionTab";
import { DiligenceTab } from "./pages/dossier/DiligenceTab";
import { TenantsTab } from "./pages/dossier/TenantsTab";
import { MoneyTab } from "./pages/dossier/MoneyTab";
import { SpecsTab } from "./pages/dossier/SpecsTab";
import { ComplianceTab } from "./pages/dossier/ComplianceTab";
import { TurnoverTab } from "./pages/dossier/TurnoverTab";
import { FilesTab } from "./pages/dossier/FilesTab";
import { TimelineTab } from "./pages/dossier/TimelineTab";
import { VendorsPage } from "./pages/VendorsPage";
import { NewPropertyPage } from "./pages/NewPropertyPage";
import { SearchPage } from "./pages/SearchPage";
import { InboxPage } from "./pages/InboxPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AdminPage } from "./pages/AdminPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import type { ReactElement } from "react";

export function AppRoutes(): ReactElement {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/invite/:token" element={<InvitePage />} />

      <Route
        element={
          <RequireAuth>
            <AuthenticatedShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/vendors" element={<VendorsPage />} />
        <Route path="/properties/new" element={<NewPropertyPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route
          path="/admin"
          element={
            <RequireOwner>
              <AdminPage />
            </RequireOwner>
          }
        />

        <Route path="/p/:propertyId" element={<DossierPage />}>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<OverviewTab />} />
          <Route path="notes" element={<NotesTab />} />
          <Route path="maintenance" element={<MaintenanceTab />} />
          <Route path="deal" element={<DealTab />} />
          {/* Still "projects": server-generated URLs point here, and the tab
              is only LABELLED Renovation on a property you do not own yet. */}
          <Route path="projects" element={<RenovationTab />} />
          <Route path="discussion" element={<DiscussionTab />} />
          <Route path="diligence" element={<DiligenceTab />} />
          <Route path="tenants" element={<TenantsTab />} />
          <Route path="money" element={<MoneyTab />} />
          <Route path="specs" element={<SpecsTab />} />
          <Route path="compliance" element={<ComplianceTab />} />
          <Route path="turnover" element={<TurnoverTab />} />
          <Route path="files" element={<FilesTab />} />
          <Route path="timeline" element={<TimelineTab />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
