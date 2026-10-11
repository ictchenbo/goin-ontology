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
import { CasesPage } from './pages/CasesPage';
import { CaseDetailPage } from './pages/CaseDetailPage';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { ActionsPage } from './pages/ActionsPage';
import { IngestPage } from './pages/IngestPage';
import { AuditPage } from './pages/AuditPage';

/** 受保护路由包装 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
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
        <Route path="cases" element={<CasesPage />} />
        <Route path="cases/:caseId" element={<CaseDetailPage />} />
        <Route path="approvals" element={<ApprovalsPage />} />
        <Route path="actions" element={<ActionsPage />} />
        <Route path="ingest" element={<IngestPage />} />
        <Route path="audit" element={<AuditPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
