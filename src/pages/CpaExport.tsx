import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { roundMoney, sumMoney } from "@/lib/utils";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { toast } from "sonner";

function downloadFile(content: string, filename: string, type = "text/csv") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function CpaExport() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(String(currentYear));

  const { data: accounts = [] } = useQuery({
    queryKey: ["gl-accounts-export"],
    queryFn: async () => {
      const { data, error } = await supabase.from("gl_accounts").select("*").order("account_number");
      if (error) throw error;
      return data;
    },
  });

  const { data: jeLines = [] } = useQuery({
    queryKey: ["je-lines-export"],
    queryFn: async () => {
      // Paginate to avoid 1000-row default limit
      let allLines: any[] = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("journal_entry_lines")
          .select("*, gl_accounts(account_number, name), journal_entries(entry_number, date, description, status)")
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allLines = allLines.concat(data);
        if (data.length < pageSize) break;
        from += pageSize;
      }
      return allLines.filter((l: any) => l.journal_entries?.status === "posted");
    },
  });

  const { data: transactions = [] } = useQuery({
    queryKey: ["transactions-export"],
    queryFn: async () => fetchAll((sb) => sb.from("transactions").select("*, jobs(job_number)").order("date")),
  });

  const { data: vendors = [] } = useQuery({
    queryKey: ["vendors-export"],
    queryFn: async () => {
      const { data, error } = await supabase.from("vendors").select("*");
      if (error) throw error;
      return data;
    },
  });

  const yearLines = useMemo(() =>
    jeLines.filter((l: any) => {
      const d = l.journal_entries?.date;
      return d && d.startsWith(year);
    }),
  [jeLines, year]);

  const yearTxns = useMemo(() =>
    transactions.filter((t) => t.date?.startsWith(year)),
  [transactions, year]);

  // =================== CSV EXPORT ===================
  const exportCSV = () => {
    const headers = ["Date", "Entry #", "Account #", "Account Name", "Description", "Debit", "Credit"];
    const rows = yearLines.map((l: any) => [
      l.journal_entries?.date || "",
      l.journal_entries?.entry_number || "",
      l.gl_accounts?.account_number || "",
      l.gl_accounts?.name || "",
      l.description || l.journal_entries?.description || "",
      roundMoney(l.debit || 0).toFixed(2),
      roundMoney(l.credit || 0).toFixed(2),
    ].map(v => `"${v}"`).join(","));
    downloadFile([headers.join(","), ...rows].join("\n"), `gl-detail-${year}.csv`);
    toast.success(`Exported ${rows.length} journal lines as CSV`);
  };

  const exportTrialBalanceCSV = () => {
    const balances: Record<string, { debit: number; credit: number }> = {};
    yearLines.forEach((l: any) => {
      const acct = l.gl_accounts?.account_number || "?";
      if (!balances[acct]) balances[acct] = { debit: 0, credit: 0 };
      balances[acct].debit = roundMoney(balances[acct].debit + (l.debit || 0));
      balances[acct].credit = roundMoney(balances[acct].credit + (l.credit || 0));
    });
    const headers = ["Account #", "Account Name", "Debit", "Credit"];
    const rows = accounts
      .filter(a => balances[a.account_number])
      .map(a => [
        `"${a.account_number}"`,
        `"${a.name}"`,
        (balances[a.account_number]?.debit || 0).toFixed(2),
        (balances[a.account_number]?.credit || 0).toFixed(2),
      ].join(","));
    downloadFile([headers.join(","), ...rows].join("\n"), `trial-balance-${year}.csv`);
    toast.success("Trial balance exported");
  };

  // =================== IIF EXPORT ===================
  const exportIIF = () => {
    const lines: string[] = [];
    // Chart of Accounts
    lines.push("!ACCNT\tNAME\tACCNTTYPE\tDESC\tACCNUM");
    const typeMap: Record<string, string> = {
      asset: "BANK", liability: "OCASSET", equity: "EQUITY",
      revenue: "INC", expense: "EXP",
    };
    accounts.forEach(a => {
      lines.push(`ACCNT\t${a.name}\t${typeMap[a.account_type] || "EXP"}\t\t${a.account_number}`);
    });

    // Transactions as General Journal entries
    lines.push("!TRNS\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tMEMO");
    lines.push("!SPL\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tMEMO");
    lines.push("!ENDTRNS");

    // Group JE lines by entry
    const byEntry: Record<string, typeof yearLines> = {};
    yearLines.forEach((l: any) => {
      const entryNo = l.journal_entries?.entry_number || l.journal_entry_id;
      if (!byEntry[entryNo]) byEntry[entryNo] = [];
      byEntry[entryNo].push(l);
    });

    Object.entries(byEntry).forEach(([_entryNo, entryLines]) => {
      entryLines.forEach((l: any, i: number) => {
        const date = (l.journal_entries?.date || "").replace(/-/g, "/");
        const acct = l.gl_accounts?.name || "";
        const amount = roundMoney((l.debit || 0) - (l.credit || 0)).toFixed(2);
        const memo = l.description || l.journal_entries?.description || "";
        if (i === 0) {
          lines.push(`TRNS\tGENERAL JOURNAL\t${date}\t${acct}\t\t${amount}\t${memo}`);
        } else {
          lines.push(`SPL\tGENERAL JOURNAL\t${date}\t${acct}\t\t${amount}\t${memo}`);
        }
      });
      lines.push("ENDTRNS");
    });

    downloadFile(lines.join("\n"), `mcrbooks-${year}.iif`, "text/plain");
    toast.success("IIF file exported for QuickBooks Desktop");
  };

  // =================== QBO (OFX) EXPORT ===================
  const exportQBO = () => {
    const now = new Date();
    const dtServer = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const startDate = `${year}0101`;
    const endDate = `${year}1231`;

    let ofx = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII

<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS><CODE>0<SEVERITY>INFO</STATUS>
<DTSERVER>${dtServer}
<LANGUAGE>ENG
</SONRS>
</SIGNONMSGSRSV1>
<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>1
<STATUS><CODE>0<SEVERITY>INFO</STATUS>
<STMTRS>
<CURDEF>USD
<BANKACCTFROM>
<BANKID>000000000
<ACCTID>0000000000
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>${startDate}
<DTEND>${endDate}
`;

    yearTxns.forEach((t) => {
      const amount = roundMoney((t.deposit || 0) - (t.payment || 0)).toFixed(2);
      const type = (t.deposit || 0) > 0 ? "CREDIT" : "DEBIT";
      const date = t.date.replace(/-/g, "");
      ofx += `<STMTTRN>
<TRNTYPE>${type}
<DTPOSTED>${date}
<TRNAMT>${amount}
<FITID>${t.id.slice(0, 20)}
<CHECKNUM>${t.check_no}
<NAME>${t.payee}
<MEMO>${t.memo}
</STMTTRN>
`;
    });

    const totalBal = sumMoney(yearTxns.map((t) => roundMoney((t.deposit || 0) - (t.payment || 0))));
    ofx += `</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>${totalBal.toFixed(2)}
<DTASOF>${endDate}
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`;

    downloadFile(ofx, `mcrbooks-${year}.qbo`, "application/x-ofx");
    toast.success("QBO file exported for QuickBooks Online");
  };

  return (
    <div className="p-8">
      <PageHeader title="CPA / Accountant Export" description="Export your books in formats your accountant can import" />

      <div className="flex items-center gap-4 mb-6">
        <div>
          <Label className="text-xs text-muted-foreground">Year</Label>
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[currentYear, currentYear - 1, currentYear - 2].map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs defaultValue="csv">
        <TabsList className="mb-6">
          <TabsTrigger value="csv">CSV / Excel</TabsTrigger>
          <TabsTrigger value="iif">IIF (QB Desktop)</TabsTrigger>
          <TabsTrigger value="qbo">QBO (QB Online)</TabsTrigger>
        </TabsList>

        <TabsContent value="csv">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileSpreadsheet className="w-5 h-5 text-primary" />GL Detail Export
                </CardTitle>
                <CardDescription>
                  Every posted journal entry line with account numbers, dates, and amounts. Universal CSV format.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-3">{yearLines.length} journal lines for {year}</p>
                <Button onClick={exportCSV} disabled={yearLines.length === 0}>
                  <Download className="w-4 h-4 mr-2" />Download GL Detail CSV
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileSpreadsheet className="w-5 h-5 text-primary" />Trial Balance Export
                </CardTitle>
                <CardDescription>
                  Summary of all account balances (debits and credits) for the year. Ideal for CPA review.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-3">{accounts.length} accounts in chart</p>
                <Button onClick={exportTrialBalanceCSV} disabled={yearLines.length === 0}>
                  <Download className="w-4 h-4 mr-2" />Download Trial Balance CSV
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="iif">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="w-5 h-5 text-primary" />QuickBooks Desktop (IIF)
              </CardTitle>
              <CardDescription>
                Intuit Interchange Format. Exports your chart of accounts and all posted journal entries. 
                Import via File → Utilities → Import → IIF Files in QuickBooks Desktop.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-3">
                {accounts.length} accounts · {Object.keys(
                  yearLines.reduce((acc: any, l: any) => { acc[l.journal_entry_id] = true; return acc; }, {})
                ).length} journal entries for {year}
              </p>
              <Button onClick={exportIIF} disabled={yearLines.length === 0}>
                <Download className="w-4 h-4 mr-2" />Download IIF File
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="qbo">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="w-5 h-5 text-primary" />QuickBooks Online (QBO / Web Connect)
              </CardTitle>
              <CardDescription>
                OFX-format bank statement file. Import via Banking → Upload transactions in QuickBooks Online.
                Contains all checkbook transactions for the selected year.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-3">{yearTxns.length} transactions for {year}</p>
              <Button onClick={exportQBO} disabled={yearTxns.length === 0}>
                <Download className="w-4 h-4 mr-2" />Download QBO File
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
