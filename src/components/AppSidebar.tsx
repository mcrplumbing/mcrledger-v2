import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  BookOpen,
  Briefcase,
  FileText,
  Users,
  TrendingUp,
  Landmark,
  CheckSquare,
  Package,
  ChevronLeft,
  ChevronRight,
  Clock,
  Settings,
  List,
  BookMarked,
  BarChart3,
  FileUp,
  Wand2,
  LogOut,
  Shield,
  HardDriveDownload,
  ShieldCheck,
  Building2,
  FileOutput,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth, AppRole } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";

type NavItem = {
  to: string;
  icon: typeof LayoutDashboard;
  label: string;
  minRole: AppRole;
  pageKey?: string; // for per-user permission check
};

const navItems: NavItem[] = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard", minRole: "viewer" },
  { to: "/bank-accounts", icon: Building2, label: "Bank Accounts", minRole: "user", pageKey: "checkbook" },
  { to: "/checkbook", icon: BookOpen, label: "Checkbook", minRole: "user", pageKey: "checkbook" },
  { to: "/jobs", icon: Briefcase, label: "Job Costing", minRole: "user", pageKey: "jobs" },
  { to: "/invoices", icon: FileText, label: "Invoices (AR)", minRole: "user", pageKey: "invoices" },
  { to: "/make-deposit", icon: Landmark, label: "Make Deposit", minRole: "user", pageKey: "invoices" },
  { to: "/vendors", icon: FileText, label: "Vendors & AP", minRole: "user", pageKey: "vendors" },
  { to: "/payroll", icon: Users, label: "Payroll", minRole: "user", pageKey: "payroll" },
  { to: "/timesheets", icon: Clock, label: "Timesheets", minRole: "user", pageKey: "timesheets" },
  { to: "/tax-settings", icon: Settings, label: "Tax Settings", minRole: "admin" },
  { to: "/employee-deductions", icon: FileText, label: "Deductions", minRole: "user", pageKey: "payroll" },
  { to: "/payroll-compliance", icon: FileText, label: "Tax Forms", minRole: "user", pageKey: "payroll" },
  { to: "/reports", icon: BarChart3, label: "Reports", minRole: "viewer" },
  { to: "/customer-profitability", icon: TrendingUp, label: "Customer Profit", minRole: "viewer" },
  { to: "/bank-reconciliation", icon: CheckSquare, label: "Bank Recon", minRole: "user", pageKey: "checkbook" },
  { to: "/chart-of-accounts", icon: List, label: "Chart of Accounts", minRole: "user", pageKey: "chart-of-accounts" },
  { to: "/journal-entries", icon: BookMarked, label: "Journal Entries", minRole: "user", pageKey: "journal-entries" },
  { to: "/loans", icon: Landmark, label: "Loans", minRole: "user", pageKey: "loans" },
  { to: "/assets", icon: Package, label: "Assets", minRole: "user", pageKey: "assets" },
  { to: "/invoice-pdf-import", icon: FileText, label: "Invoice PDF Import", minRole: "user", pageKey: "vendors" },
  { to: "/csv-import", icon: FileUp, label: "CSV Import", minRole: "admin" },
  { to: "/opening-balances", icon: Wand2, label: "Opening Balances", minRole: "admin" },
  { to: "/job-opening-balances", icon: Briefcase, label: "Job Opening Bal.", minRole: "admin" },
  { to: "/ap-opening-balances", icon: FileText, label: "AP Opening Bal.", minRole: "admin" },
  { to: "/user-management", icon: Shield, label: "User Management", minRole: "admin" },
  { to: "/data-backup", icon: HardDriveDownload, label: "Backup & Restore", minRole: "admin" },
  { to: "/cpa-export", icon: FileOutput, label: "CPA Export", minRole: "admin" },
  { to: "/period-close", icon: ShieldCheck, label: "Period Close & Audit", minRole: "admin" },
  { to: "/migration-checklist", icon: CheckSquare, label: "Migration Checklist", minRole: "admin" },
];

const roleLevel: Record<AppRole, number> = { admin: 3, user: 2, viewer: 1 };

function hasAccess(userRole: AppRole, minRole: AppRole): boolean {
  return roleLevel[userRole] >= roleLevel[minRole];
}

export default function AppSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const { signOut, user, role, hasPageAccess } = useAuth();

  const visibleItems = navItems.filter((item) => {
    // First check role level
    if (!hasAccess(role, item.minRole)) return false;
    // For User role with assignable pages, check per-user permissions
    if (role === "user" && item.pageKey) {
      return hasPageAccess(item.pageKey);
    }
    return true;
  });

  const roleBadgeVariant = role === "admin" ? "destructive" as const : role === "user" ? "default" as const : "secondary" as const;

  return (
    <aside
      className={cn(
        "flex flex-col h-screen bg-sidebar border-r border-sidebar-border transition-all duration-300",
        collapsed ? "w-16" : "w-60"
      )}
    >
      <div className="flex items-center gap-3 px-4 h-16 border-b border-sidebar-border">
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
          <BookOpen className="w-4 h-4 text-primary-foreground" />
        </div>
        {!collapsed && (
          <span className="font-display font-bold text-sidebar-primary-foreground text-lg tracking-tight">
            LedgerPro
          </span>
        )}
      </div>

      <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
        {visibleItems.map((item) => {
          const isActive =
            item.to === "/"
              ? location.pathname === "/"
              : location.pathname.startsWith(item.to);
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
                isActive
                  ? "bg-sidebar-accent text-sidebar-primary-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
              )}
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border">
        {!collapsed && user && (
          <div className="px-4 py-2 flex items-center gap-2">
            <span className="text-xs text-sidebar-foreground/60 truncate flex-1">{user.email}</span>
            <Badge variant={roleBadgeVariant} className="text-[10px] px-1.5 py-0">{role}</Badge>
          </div>
        )}
        <div className="flex">
          <button
            onClick={() => signOut()}
            className="flex-1 flex items-center justify-center gap-2 h-12 text-sidebar-foreground hover:text-destructive transition-colors"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
            {!collapsed && <span className="text-sm">Sign Out</span>}
          </button>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex items-center justify-center w-12 h-12 text-sidebar-foreground hover:text-sidebar-accent-foreground transition-colors"
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </aside>
  );
}

export { hasAccess, roleLevel };
