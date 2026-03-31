import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

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
    const { content, tax_type, effective_year, state_name, job_id: pollJobId } = await req.json();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // If polling for a job result
    if (pollJobId) {
      const { data: job, error } = await supabase
        .from("tax_parse_jobs")
        .select("id, status, result, error")
        .eq("id", pollJobId)
        .single();
      if (error) throw error;
      return new Response(JSON.stringify(job), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create a new parsing job
    if (!content || !tax_type) {
      return new Response(
        JSON.stringify({ success: false, error: "Content and tax_type are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Truncate to ~80k chars to keep payload manageable
    const truncatedContent = content.slice(0, 80000);

    const { data: job, error: insertError } = await supabase
      .from("tax_parse_jobs")
      .insert({
        tax_type,
        effective_year: effective_year || 2026,
        state_name: state_name || null,
        input_text: truncatedContent,
        status: "processing",
      })
      .select("id")
      .single();

    if (insertError) throw insertError;

    // Process in background using EdgeRuntime.waitUntil
    const processPromise = (async () => {
      try {
        const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
        if (!LOVABLE_API_KEY) {
          await supabase.from("tax_parse_jobs").update({ status: "failed", error: "AI service not configured", updated_at: new Date().toISOString() }).eq("id", job.id);
          return;
        }

        const systemPrompt = `You are a tax table parser. Extract withholding tax bracket data from the pasted IRS Publication 15-T or state withholding guide text.

Return structured data using the extract_tax_brackets tool. For each bracket row, extract:
- bracket_min: the lower bound of the wage/income range (number)
- bracket_max: the upper bound, or null if no upper limit  
- rate: the tax rate as a decimal (e.g. 0.10 for 10%). For wage bracket tables, set to 0.
- withholding_amount: for wage bracket tables, the fixed dollar withholding amount. For percentage method, set to 0.
- filing_status: "single" or "married"
- method: "percentage" or "wage_bracket"
- pay_period: "weekly", "biweekly", "semimonthly", or "monthly"
- allowances: number of withholding allowances (0 if not specified or for percentage method)
- description: a short label for this bracket (e.g. "10% bracket", "$50-$100 weekly single 0 allowances")

Parse ALL brackets you can find. If the text contains multiple tables (e.g. single and married, or multiple pay periods), extract all of them.
If data is unclear, make your best interpretation and include a note in the description.`;

        const userPrompt = `Parse the following ${tax_type === "federal" ? "Federal (IRS)" : `State (${state_name || tax_type})`} tax withholding table for year ${effective_year || 2026}:\n\n${truncatedContent}`;

        const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            tools: [
              {
                type: "function",
                function: {
                  name: "extract_tax_brackets",
                  description: "Extract tax bracket rows from pasted tax table content",
                  parameters: {
                    type: "object",
                    properties: {
                      brackets: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            bracket_min: { type: "number" },
                            bracket_max: { type: ["number", "null"] },
                            rate: { type: "number" },
                            withholding_amount: { type: "number" },
                            filing_status: { type: "string", enum: ["single", "married"] },
                            method: { type: "string", enum: ["percentage", "wage_bracket"] },
                            pay_period: { type: "string", enum: ["weekly", "biweekly", "semimonthly", "monthly"] },
                            allowances: { type: "integer" },
                            description: { type: "string" },
                          },
                          required: ["bracket_min", "rate", "filing_status", "method", "pay_period", "description"],
                          additionalProperties: false,
                        },
                      },
                      summary: { type: "string", description: "Brief summary of what was parsed" },
                    },
                    required: ["brackets", "summary"],
                    additionalProperties: false,
                  },
                },
              },
            ],
            tool_choice: { type: "function", function: { name: "extract_tax_brackets" } },
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          console.error("AI gateway error:", response.status, errText);
          let errorMsg = "AI processing failed";
          if (response.status === 429) errorMsg = "Rate limit exceeded. Please try again in a moment.";
          if (response.status === 402) errorMsg = "AI credits exhausted.";
          await supabase.from("tax_parse_jobs").update({ status: "failed", error: errorMsg, updated_at: new Date().toISOString() }).eq("id", job.id);
          return;
        }

        const aiData = await response.json();
        const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];

        if (!toolCall?.function?.arguments) {
          await supabase.from("tax_parse_jobs").update({ status: "failed", error: "AI could not extract tax brackets from the provided text", updated_at: new Date().toISOString() }).eq("id", job.id);
          return;
        }

        const parsed = JSON.parse(toolCall.function.arguments);
        await supabase.from("tax_parse_jobs").update({ status: "complete", result: parsed, updated_at: new Date().toISOString() }).eq("id", job.id);
      } catch (e) {
        console.error("Background parse error:", e);
        await supabase.from("tax_parse_jobs").update({ status: "failed", error: e instanceof Error ? e.message : "Unknown error", updated_at: new Date().toISOString() }).eq("id", job.id);
      }
    })();

    // Use EdgeRuntime.waitUntil to keep processing after response
    // @ts-ignore - EdgeRuntime is available in Supabase Edge Functions
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      EdgeRuntime.waitUntil(processPromise);
    } else {
      // Fallback: just await it (may timeout for very large docs)
      await processPromise;
    }

    return new Response(
      JSON.stringify({ success: true, job_id: job.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("parse-tax-tables error:", e);
    return new Response(
      JSON.stringify({ success: false, error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
