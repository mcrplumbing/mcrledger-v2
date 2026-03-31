import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization")!;

  // Verify caller is admin
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  // Check caller is admin
  const { data: isAdmin } = await adminClient.rpc("has_role", { _user_id: user.id, _role: "admin" });
  if (!isAdmin) {
    return new Response(JSON.stringify({ error: "Admin access required" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await req.json();
  const { action } = body;

  try {
    if (action === "list") {
      const { data: authUsers, error: listErr } = await adminClient.auth.admin.listUsers();
      if (listErr) throw listErr;

      const { data: roles } = await adminClient.from("user_roles").select("*");
      const roleMap = new Map((roles || []).map((r: any) => [r.user_id, r.role]));

      const { data: perms } = await adminClient.from("user_page_permissions").select("*");
      const permMap = new Map<string, string[]>();
      (perms || []).forEach((p: any) => {
        if (!permMap.has(p.user_id)) permMap.set(p.user_id, []);
        permMap.get(p.user_id)!.push(p.page_key);
      });

      const users = (authUsers?.users || []).map((u: any) => ({
        user_id: u.id,
        email: u.email,
        role: roleMap.get(u.id) || "viewer",
        permissions: permMap.get(u.id) || [],
      }));

      return new Response(JSON.stringify({ users }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "invite") {
      const { email, role } = body;
      const { data: newUser, error: createErr } = await adminClient.auth.admin.inviteUserByEmail(email);
      if (createErr) throw createErr;

      if (newUser?.user) {
        await adminClient.from("user_roles").upsert({
          user_id: newUser.user.id,
          role: role || "user",
        }, { onConflict: "user_id,role" });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "update_role") {
      const { user_id: targetId, role } = body;
      await adminClient.from("user_roles").delete().eq("user_id", targetId);
      await adminClient.from("user_roles").insert({ user_id: targetId, role });

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "update_permissions") {
      const { user_id: targetId, permissions } = body;
      // Delete existing, insert new
      await adminClient.from("user_page_permissions").delete().eq("user_id", targetId);
      if (permissions && permissions.length > 0) {
        const rows = permissions.map((page_key: string) => ({ user_id: targetId, page_key }));
        const { error } = await adminClient.from("user_page_permissions").insert(rows);
        if (error) throw error;
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
