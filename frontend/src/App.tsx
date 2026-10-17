/**
 * 路由入口：公开/受保护路由与 404
 */
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { ModelStudioPage, ObjectTypeDetailPage, ModelModuleDetailPage } from './pages/ModelStudioPage';
import { ObjectsPage } from './pages/ObjectsPage';
import { ObjectDetailPage } from './pages/ObjectDetailPage';
import { CasesPage } from './pages/CasesPage';
import { CaseDetailPage } from './pages/CaseDetailPage';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { ActionsPage } from './pages/ActionsPage';
import { IngestPage } from './pages/IngestPage';
import { AuditPage } from './pages/AuditPage';
import { getCurrentDomain } from './lib/domain';
import { DomainSelectPage } from './pages/DomainSelectPage';
import { DomainAdminPage, DomainDetailPage } from './pages/DomainAdminPage';

/** 受保护路由包装 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div role="status" className="p-6">正在验证登录状态…</div>;
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}

function RequireDomain({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  if (!getCurrentDomain()) return <Navigate to="/domains/select" state={{ from: location.pathname }} replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/domains/select" element={<RequireAuth><DomainSelectPage /></RequireAuth>} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <RequireDomain><Layout /></RequireDomain>
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="ontology" element={<ModelStudioPage />} />
        <Route path="ontology/types" element={<ModelStudioPage />} />
        <Route path="ontology/types/:typeKey" element={<ObjectTypeDetailPage />} />
        <Route path="ontology/:module" element={<ModelStudioPage />} />
        <Route path="ontology/:module/:itemKey" element={<ModelModuleDetailPage />} />
        <Route path="objects" element={<ObjectsPage />} />
        <Route path="objects/:objectId" element={<ObjectDetailPage />} />
        <Route path="cases" element={<CasesPage />} />
        <Route path="cases/:caseId" element={<CaseDetailPage />} />
        <Route path="approvals" element={<ApprovalsPage />} />
        <Route path="actions" element={<ActionsPage />} />
        <Route path="ingest" element={<IngestPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="admin/domains" element={<DomainAdminPage />} />
        <Route path="admin/domains/:domainId" element={<DomainDetailPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
