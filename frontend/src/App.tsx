import { Suspense, lazy, type ReactNode } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import LoginPage from '@/auth/LoginPage';
import InviteAcceptPage from '@/pages/InviteAccept';
import { ProtectedRoute } from '@/auth/ProtectedRoute';
import Layout from '@/components/Layout';
import ErrorBoundary from '@/components/ErrorBoundary';

const Dashboard = lazy(() => import('@/pages/Dashboard'));
const UsersPage = lazy(() => import('@/pages/Users'));
const TenantsPage = lazy(() => import('@/pages/Tenants'));
const Tenant360Page = lazy(() => import('@/pages/Tenant360'));
const ProjectsPage = lazy(() => import('@/pages/Projects'));
const InstallationsPage = lazy(() => import('@/pages/Installations'));
const InstallationDetailPage = lazy(() => import('@/pages/InstallationDetail'));
const DirectionsPage = lazy(() => import('@/pages/Directions'));
const ServiceRequestsPage = lazy(() => import('@/pages/ServiceRequests'));
const ServiceChatsPage = lazy(() => import('@/pages/ServiceChats'));
const MaintenancePlansPage = lazy(() => import('@/pages/MaintenancePlans'));
const ContractsPage = lazy(() => import('@/pages/Contracts'));
const CalendarPage = lazy(() => import('@/pages/Calendar'));
const NotificationsPage = lazy(() => import('@/pages/Notifications'));
const SearchPage = lazy(() => import('@/pages/Search'));
const ProfilePage = lazy(() => import('@/pages/Profile'));
const EmailQueueManagerPage = lazy(() => import('@/pages/EmailQueueManager'));
const EmailTemplatesPage = lazy(() => import('@/pages/EmailTemplates'));
const CustomFieldsSettingsPage = lazy(() => import('@/pages/CustomFieldsSettings'));
const WorkflowAutomationPage = lazy(() => import('@/pages/WorkflowAutomation'));
const AiChatPage = lazy(() => import('@/pages/AiChat'));
const SppzJournalIsolatedPage = lazy(() => import('@/pages/SppzJournalIsolated'));
const SppzCustomerSignPage = lazy(() => import('@/pages/SppzCustomerSign'));
const SppzExtPublicPage = lazy(() => import('@/pages/SppzExtPublic'));
const KnowledgeBasePage = lazy(() => import('@/pages/KnowledgeBase'));
const ReportsPage = lazy(() => import('@/pages/Reports'));
const AnalyticsPage = lazy(() => import('@/pages/Analytics'));
const ApiDocsPage = lazy(() => import('@/pages/ApiDocs'));
const ModuleManagerPage = lazy(() => import('@/pages/ModuleManager'));

function RouteFallback() {
  const { t } = useTranslation();
  return <div className="p-4 text-sm text-slate-500">{t('common.loading')}</div>;
}

function withSuspense(element: ReactNode) {
  return <Suspense fallback={<RouteFallback />}>{element}</Suspense>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/invite-accept" element={<InviteAcceptPage />} />
        <Route
          path="/sppz-journal/customer-sign"
          element={withSuspense(<SppzCustomerSignPage />)}
        />
        <Route
          path="/sppz-journal/ext/:token"
          element={withSuspense(<SppzExtPublicPage />)}
        />

        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={withSuspense(<Dashboard />)} />
          <Route path="users" element={withSuspense(<UsersPage />)} />
          <Route path="tenants" element={withSuspense(<TenantsPage />)} />
          <Route path="tenants/:id/360" element={withSuspense(<Tenant360Page />)} />
          <Route path="projects" element={withSuspense(<ProjectsPage />)} />
          <Route path="installations" element={withSuspense(<InstallationsPage />)} />
          <Route path="installations/:id" element={withSuspense(<InstallationDetailPage />)} />
          <Route path="directions" element={withSuspense(<DirectionsPage />)} />
          <Route path="service-requests" element={withSuspense(<ServiceRequestsPage />)} />
          <Route path="service-chats" element={withSuspense(<ServiceChatsPage />)} />
          <Route path="maintenance-plans" element={withSuspense(<MaintenancePlansPage />)} />
          <Route path="contracts" element={withSuspense(<ContractsPage />)} />
          <Route path="calendar" element={withSuspense(<CalendarPage />)} />
          <Route path="notifications" element={withSuspense(<NotificationsPage />)} />
          <Route path="search" element={withSuspense(<SearchPage />)} />
          <Route path="profile" element={withSuspense(<ProfilePage />)} />
          <Route path="settings/email-queue" element={withSuspense(<EmailQueueManagerPage />)} />
          <Route path="settings/email-templates" element={withSuspense(<EmailTemplatesPage />)} />
          <Route path="settings/custom-fields" element={withSuspense(<CustomFieldsSettingsPage />)} />
          <Route path="settings/workflow-automation" element={withSuspense(<WorkflowAutomationPage />)} />
          <Route path="sppz-journal" element={withSuspense(<SppzJournalIsolatedPage />)} />
          <Route path="ai-chat" element={withSuspense(<AiChatPage />)} />
          <Route path="knowledge-base" element={withSuspense(<KnowledgeBasePage />)} />
          <Route path="reports" element={withSuspense(<ReportsPage />)} />
          <Route path="analytics" element={withSuspense(<AnalyticsPage />)} />
          <Route path="api-docs-portal" element={withSuspense(<ApiDocsPage />)} />
          <Route path="modules" element={withSuspense(<ModuleManagerPage />)} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}
