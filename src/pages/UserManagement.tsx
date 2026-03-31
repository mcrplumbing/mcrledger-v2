import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, AppRole, ASSIGNABLE_PAGES, PAGE_LABELS, PageKey } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Shield, UserPlus, Loader2, Settings2 } from "lucide-react";
import { toast } from "sonner";

interface UserWithRole {
  user_id: string;
  email: string;
  role: AppRole;
  permissions: string[];
}

export default function UserManagement() {
  const { role: myRole } = useAuth();
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AppRole>("user");
  const [inviting, setInviting] = useState(false);
  const [permDialogUser, setPermDialogUser] = useState<UserWithRole | null>(null);
  const [editPerms, setEditPerms] = useState<string[]>([]);

  const fetchUsers = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("manage-users", {
      body: { action: "list" },
    });
    if (error) {
      toast.error("Failed to load users");
    } else {
      setUsers(data?.users ?? []);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (myRole === "admin") fetchUsers();
  }, [myRole]);

  const handleInvite = async () => {
    if (!inviteEmail) return;
    setInviting(true);
    const { data, error } = await supabase.functions.invoke("manage-users", {
      body: { action: "invite", email: inviteEmail, role: inviteRole },
    });
    setInviting(false);
    if (error || data?.error) {
      toast.error(data?.error || "Failed to invite user");
    } else {
      toast.success(`Invited ${inviteEmail} as ${inviteRole}`);
      setInviteEmail("");
      fetchUsers();
    }
  };

  const handleRoleChange = async (userId: string, newRole: AppRole) => {
    const { data, error } = await supabase.functions.invoke("manage-users", {
      body: { action: "update_role", user_id: userId, role: newRole },
    });
    if (error || data?.error) {
      toast.error(data?.error || "Failed to update role");
    } else {
      toast.success("Role updated");
      fetchUsers();
    }
  };

  const openPermissions = (user: UserWithRole) => {
    setPermDialogUser(user);
    setEditPerms([...user.permissions]);
  };

  const togglePerm = (pageKey: string) => {
    setEditPerms((prev) =>
      prev.includes(pageKey) ? prev.filter((p) => p !== pageKey) : [...prev, pageKey]
    );
  };

  const savePermissions = async () => {
    if (!permDialogUser) return;
    const { data, error } = await supabase.functions.invoke("manage-users", {
      body: { action: "update_permissions", user_id: permDialogUser.user_id, permissions: editPerms },
    });
    if (error || data?.error) {
      toast.error(data?.error || "Failed to update permissions");
    } else {
      toast.success("Permissions updated");
      setPermDialogUser(null);
      fetchUsers();
    }
  };

  if (myRole !== "admin") {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <Shield className="mx-auto h-12 w-12 mb-4 opacity-40" />
        <p className="text-lg font-medium">Admin access required</p>
      </div>
    );
  }

  const roleBadgeVariant = (role: AppRole) => {
    switch (role) {
      case "admin": return "destructive" as const;
      case "user": return "default" as const;
      case "viewer": return "secondary" as const;
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">User Management</h1>
        <p className="text-muted-foreground">Manage team access and roles</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <UserPlus className="h-5 w-5" /> Invite User
          </CardTitle>
          <CardDescription>Send an invite to a new team member</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 space-y-1">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="accountant@company.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </div>
            <div className="w-40 space-y-1">
              <Label>Role</Label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as AppRole)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={handleInvite} disabled={inviting || !inviteEmail}>
                {inviting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Invite
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Permissions dialog */}
      <Dialog open={!!permDialogUser} onOpenChange={() => setPermDialogUser(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Page Permissions — {permDialogUser?.email}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground mb-4">
            Toggle which operational pages this user can access. Dashboard, Reports, and GL Reports are always visible.
          </p>
          <div className="space-y-3">
            {ASSIGNABLE_PAGES.map((pageKey) => (
              <label key={pageKey} className="flex items-center gap-3 cursor-pointer">
                <Checkbox
                  checked={editPerms.includes(pageKey)}
                  onCheckedChange={() => togglePerm(pageKey)}
                />
                <span className="text-sm font-medium text-foreground">{PAGE_LABELS[pageKey]}</span>
              </label>
            ))}
          </div>
          <div className="flex justify-between mt-4">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditPerms([...ASSIGNABLE_PAGES])}>Select All</Button>
              <Button variant="outline" size="sm" onClick={() => setEditPerms([])}>Clear All</Button>
            </div>
            <Button onClick={savePermissions}>Save Permissions</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Team Members</CardTitle>
          <CardDescription>
            <strong>Admin</strong> — full access &nbsp;|&nbsp;
            <strong>User</strong> — configurable page access &nbsp;|&nbsp;
            <strong>Viewer</strong> — read-only (Dashboard, Reports, GL Reports)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="w-48">Change Role</TableHead>
                  <TableHead className="w-32">Pages</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.user_id}>
                    <TableCell className="font-medium">{u.email}</TableCell>
                    <TableCell>
                      <Badge variant={roleBadgeVariant(u.role)}>{u.role}</Badge>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={u.role}
                        onValueChange={(v) => handleRoleChange(u.user_id, v as AppRole)}
                      >
                        <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="user">User</SelectItem>
                          <SelectItem value="viewer">Viewer</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {u.role === "user" ? (
                        <Button variant="outline" size="sm" onClick={() => openPermissions(u)}>
                          <Settings2 className="w-3.5 h-3.5 mr-1" />
                          {u.permissions.length}/{ASSIGNABLE_PAGES.length}
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {u.role === "admin" ? "Full" : "Read-only"}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {users.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                      No users found. Invite your first team member above.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
