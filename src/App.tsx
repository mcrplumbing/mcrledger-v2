import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import Dashboard from "@/pages/Dashboard";
import Checkbook from "@/pages/Checkbook";
import BankAccounts from "@/pages/BankAccounts";
import Jobs from "@/pages/Jobs";
import Vendors from "@/pages/Vendors";
import Payroll from "@/pages/Payroll";
import Timesheets from "@/pages/Timesheets";
import TaxSettings from "@/pages/TaxSettings";
import EmployeeDeductions from "@/pages/EmployeeDeductions";
import Reports from "@/pages/GLReports";
import Loans from "@/pages/Loans";
import Assets from "@/pages/Assets";
import Invoices from "@/pages/Invoices";
import ChartOfAccounts from "@/pages/ChartOfAccounts";
import JournalEntries from "@/pages/JournalEntries";
import BankReconciliation from "@/pages/BankReconciliation";
import PayrollCompliance from "@/pages/PayrollCompliance";
import CsvImport from "@/pages/CsvImport";
import InvoicePdfImport from "@/pages/InvoicePdfImport";
import OpeningBalances from "@/pages/OpeningBalances";
import UserManagement from "@/pages/UserManagement";
import DataBackup from "@/pages/DataBackup";
import CpaExport from "@/pages/CpaExport";
import PeriodClose from "@/pages/PeriodClose";
import MakeDeposit from "@/pages/MakeDeposit";
import MigrationChecklist from "@/pages/MigrationChecklist";
import JobOpeningBalances from "@/pages/JobOpeningBalances";
import ApOpeningBalances from "@/pages/ApOpeningBalances";
import CustomerProfitability from "@/pages/CustomerProfitability";
import Login from "@/pages/Login";
import ResetPassword from "@/pages/ResetPassword";
import NotFound from "@/pages/NotFound";
import type { AppRole } from "@/contexts/AuthContext";

const queryClient = new QueryClient();

const roleLevel: Record<AppRole, number> = { admin: 3, user: 2, viewer: 1 };

function RoleGate({ minRole, pageKey, children }: { minRole: AppRole; pageKey?: string; children: React.ReactNode }) {
  const { role, hasPageAccess } = useAuth();
  if (roleLevel[role] < roleLevel[minRole]) return <Navigate to="/" replace />;
  // For user role with per-page permissions
  if (role === "user" && pageKey && !hasPageAccess(pageKey)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center text-muted-foreground">Loading…</div>;
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function PublicOnlyRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return null;
  if (session) return <Navigate to="/" replace />;
  return <>{children}</>;
}

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<PublicOnlyRoute><Login /></PublicOnlyRoute>} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/checkbook" element={<RoleGate minRole="user" pageKey="checkbook"><Checkbook /></RoleGate>} />
                <Route path="/bank-accounts" element={<RoleGate minRole="user" pageKey="checkbook"><BankAccounts /></RoleGate>} />
                <Route path="/jobs" element={<RoleGate minRole="user" pageKey="jobs"><Jobs /></RoleGate>} />
                <Route path="/vendors" element={<RoleGate minRole="user" pageKey="vendors"><Vendors /></RoleGate>} />
                <Route path="/payroll" element={<RoleGate minRole="user" pageKey="payroll"><Payroll /></RoleGate>} />
                <Route path="/timesheets" element={<RoleGate minRole="user" pageKey="timesheets"><Timesheets /></RoleGate>} />
                <Route path="/tax-settings" element={<RoleGate minRole="admin"><TaxSettings /></RoleGate>} />
                <Route path="/employee-deductions" element={<RoleGate minRole="user" pageKey="payroll"><EmployeeDeductions /></RoleGate>} />
                <Route path="/payroll-compliance" element={<RoleGate minRole="user" pageKey="payroll"><PayrollCompliance /></RoleGate>} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/customer-profitability" element={<RoleGate minRole="viewer"><CustomerProfitability /></RoleGate>} />
                <Route path="/bank-reconciliation" element={<RoleGate minRole="user" pageKey="checkbook"><BankReconciliation /></RoleGate>} />
                <Route path="/loans" element={<RoleGate minRole="user" pageKey="loans"><Loans /></RoleGate>} />
                <Route path="/assets" element={<RoleGate minRole="user" pageKey="assets"><Assets /></RoleGate>} />
                <Route path="/invoices" element={<RoleGate minRole="user" pageKey="invoices"><Invoices /></RoleGate>} />
                <Route path="/make-deposit" element={<RoleGate minRole="user" pageKey="invoices"><MakeDeposit /></RoleGate>} />
                <Route path="/chart-of-accounts" element={<RoleGate minRole="user" pageKey="chart-of-accounts"><ChartOfAccounts /></RoleGate>} />
                <Route path="/journal-entries" element={<RoleGate minRole="user" pageKey="journal-entries"><JournalEntries /></RoleGate>} />
                <Route path="/csv-import" element={<RoleGate minRole="admin"><CsvImport /></RoleGate>} />
                <Route path="/invoice-pdf-import" element={<RoleGate minRole="user" pageKey="vendors"><InvoicePdfImport /></RoleGate>} />
                <Route path="/opening-balances" element={<RoleGate minRole="admin"><OpeningBalances /></RoleGate>} />
                <Route path="/job-opening-balances" element={<RoleGate minRole="admin"><JobOpeningBalances /></RoleGate>} />
                <Route path="/ap-opening-balances" element={<RoleGate minRole="admin"><ApOpeningBalances /></RoleGate>} />
                <Route path="/user-management" element={<RoleGate minRole="admin"><UserManagement /></RoleGate>} />
                <Route path="/data-backup" element={<RoleGate minRole="admin"><DataBackup /></RoleGate>} />
                <Route path="/cpa-export" element={<RoleGate minRole="admin"><CpaExport /></RoleGate>} />
                <Route path="/period-close" element={<RoleGate minRole="admin"><PeriodClose /></RoleGate>} />
                <Route path="/migration-checklist" element={<RoleGate minRole="admin"><MigrationChecklist /></RoleGate>} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
