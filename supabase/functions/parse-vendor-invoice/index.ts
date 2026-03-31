import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { pdfText, vendorNames } = await req.json();
    if (!pdfText || typeof pdfText !== "string") {
      return new Response(JSON.stringify({ error: "pdfText is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const vendorList = vendorNames?.length
      ? `\nKnown vendors in the system: ${vendorNames.join(", ")}`
      : "";

    const systemPrompt = `You are a document parsing assistant that extracts invoice data from PDF text. Extract ALL invoices found in the text. For each invoice, extract the fields listed below. If a field is not found, use null.${vendorList}

When matching vendor names, try to match to a known vendor if one is similar. Return the closest match.`;

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: `Extract invoice data from this PDF text:\n\n${pdfText.slice(0, 15000)}`,
            },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "extract_invoices",
                description:
                  "Extract one or more invoices from PDF text content",
                parameters: {
                  type: "object",
                  properties: {
                    invoices: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          vendor_name: {
                            type: "string",
                            description: "Vendor / supplier name",
                          },
                          invoice_number: {
                            type: "string",
                            description: "Invoice number or reference",
                          },
                          amount: {
                            type: "number",
                            description: "Total invoice amount",
                          },
                          date: {
                            type: "string",
                            description: "Invoice date in YYYY-MM-DD format",
                          },
                          due_date: {
                            type: "string",
                            description:
                              "Due date in YYYY-MM-DD format, or null",
                          },
                          description: {
                            type: "string",
                            description:
                              "Brief description of goods/services",
                          },
                        },
                        required: [
                          "vendor_name",
                          "invoice_number",
                          "amount",
                        ],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["invoices"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: {
            type: "function",
            function: { name: "extract_invoices" },
          },
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add funds in Settings → Workspace → Usage." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      throw new Error("AI parsing failed");
    }

    const result = await response.json();
    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      throw new Error("AI did not return structured data");
    }

    const parsed = JSON.parse(toolCall.function.arguments);
    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("parse-vendor-invoice error:", e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
