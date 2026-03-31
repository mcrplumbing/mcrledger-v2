import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || "").split(",").map((s) => s.trim()).filter(Boolean);
const CORS_ALLOW_HEADERS = "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version";

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
  };
}

// Known IRS and CA tax publication URLs
// These are the most recent known locations — may need updating if IRS changes paths
const SOURCES: Record<string, { url: string; label: string; tax_type: string; state_name?: string }> = {
  federal: {
    url: "https://www.irs.gov/pub/irs-pdf/p15t.pdf",
    label: "IRS Publication 15-T (Federal Withholding)",
    tax_type: "federal",
  },
  california: {
    url: "https://www.edd.ca.gov/siteassets/files/pdf_pub_ctr/de44.pdf",
    label: "CA DE 44 (California Withholding)",
    tax_type: "state",
    state_name: "California",
  },
};

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { source } = await req.json();

    if (!source || !SOURCES[source]) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Invalid source. Use: ${Object.keys(SOURCES).join(", ")}`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const s = SOURCES[source];
    console.log(`Fetching ${s.label} from ${s.url}`);

    const response = await fetch(s.url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MCRLedger/1.0)",
      },
    });

    if (!response.ok) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Failed to fetch PDF: HTTP ${response.status}. The URL may have changed — try downloading manually from irs.gov or edd.ca.gov.`,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("pdf") && !contentType.includes("octet-stream")) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Expected PDF but received ${contentType}. The government site may have changed their URL structure.`,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Return the PDF as base64 so the client can use pdf.js to extract text
    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    
    // Convert to base64
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);

    return new Response(
      JSON.stringify({
        success: true,
        label: s.label,
        tax_type: s.tax_type,
        state_name: s.state_name || null,
        pdf_base64: base64,
        size_kb: Math.round(arrayBuffer.byteLength / 1024),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("fetch-tax-pdfs error:", e);
    return new Response(
      JSON.stringify({
        success: false,
        error: e instanceof Error ? e.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
