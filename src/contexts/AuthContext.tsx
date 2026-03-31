import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "user" | "viewer";

// Operational page keys that can be assigned per-user
export const ASSIGNABLE_PAGES = [
  "checkbook",
  "jobs",
  "invoices",
  "vendors",
  "payroll",
  "timesheets",
  "chart-of-accounts",
  "journal-entries",
  "loans",
  "assets",
] as const;

export type PageKey = (typeof ASSIGNABLE_PAGES)[number];

export const PAGE_LABELS: Record<PageKey, string> = {
  checkbook: "Checkbook",
  jobs: "Job Costing",
  invoices: "Invoices (AR)",
  vendors: "Vendors & AP",
  payroll: "Payroll",
  timesheets: "Timesheets",
  "chart-of-accounts": "Chart of Accounts",
  "journal-entries": "Journal Entries",
  loans: "Loans",
  assets: "Assets",
};

interface AuthContextType {
  session: Session | null;
  user: User | null;
  role: AppRole;
  permissions: PageKey[];
  loading: boolean;
  signOut: () => Promise<void>;
  refreshRole: () => Promise<void>;
  hasPageAccess: (pageKey: string) => boolean;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  role: "viewer",
  permissions: [],
  loading: true,
  signOut: async () => {},
  refreshRole: async () => {},
  hasPageAccess: () => false,
});

export const useAuth = () => useContext(AuthContext);

async function fetchRole(userId: string): Promise<AppRole> {
  const { data, error } = await supabase.rpc("get_user_role", { _user_id: userId });
  if (error) {
    console.error("Failed to fetch user role:", error.message);
    return "viewer";
  }
  if (!data) return "viewer";
  return data as AppRole;
}

async function fetchPermissions(userId: string): Promise<PageKey[]> {
  const { data, error } = await supabase
    .from("user_page_permissions")
    .select("page_key")
    .eq("user_id", userId);
  if (error) {
    console.error("Failed to fetch user permissions:", error.message);
    return [];
  }
  if (!data) return [];
  return data.map((r: any) => r.page_key as PageKey);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole>("viewer");
  const [permissions, setPermissions] = useState<PageKey[]>([]);
  const [loading, setLoading] = useState(true);

  const loadRoleAndPermissions = async (userId: string) => {
    const [r, perms] = await Promise.all([fetchRole(userId), fetchPermissions(userId)]);
    setRole(r);
    setPermissions(perms);
  };

  useEffect(() => {
    let mounted = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!mounted) return;
        setSession(session);
        if (session?.user) {
          // Don't await inside onAuthStateChange to avoid deadlocks
          loadRoleAndPermissions(session.user.id)
            .then(() => { if (mounted) setLoading(false); })
            .catch((err) => {
              console.error("Auth state change: failed to load role/permissions:", err);
              if (mounted) setLoading(false);
            });
        } else {
          setRole("viewer");
          setPermissions([]);
          setLoading(false);
        }
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      setSession(session);
      if (session?.user) {
        loadRoleAndPermissions(session.user.id)
          .then(() => { if (mounted) setLoading(false); })
          .catch((err) => {
            console.error("Initial session: failed to load role/permissions:", err);
            if (mounted) setLoading(false);
          });
      } else {
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const refreshRole = async () => {
    if (session?.user) await loadRoleAndPermissions(session.user.id);
  };

  // Determine if user can access a given page
  const hasPageAccess = (pageKey: string): boolean => {
    // Admins always have full access
    if (role === "admin") return true;
    // Viewers only see dashboard, reports, gl-reports (handled by sidebar minRole)
    if (role === "viewer") return false;
    // User role: check if it's an assignable page
    if (ASSIGNABLE_PAGES.includes(pageKey as PageKey)) {
      return permissions.includes(pageKey as PageKey);
    }
    // Non-assignable pages (dashboard, reports, gl-reports) are open to users
    return true;
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, role, permissions, loading, signOut, refreshRole, hasPageAccess }}>
      {children}
    </AuthContext.Provider>
  );
}
