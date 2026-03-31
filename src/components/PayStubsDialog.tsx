import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Printer } from "lucide-react";
import { fmt } from "@/lib/utils";

interface PayStubEntry {
  id: string;
  employee_id?: string;
  employees?: { name?: string; role?: string; employee_number?: string } | null;
  hours_worked: number;
  gross_pay: number;
  fed_tax: number;
  state_tax: number;
  ss_tax?: number;
  medicare_tax?: number;
  sdi_tax?: number;
  fica: number;
  net_pay: number;
}

export interface YtdTotals {
  gross: number;
  fed_tax: number;
  state_tax: number;
  ss_tax: number;
  medicare_tax: number;
  sdi_tax: number;
  fica: number;
  net: number;
  hours: number;
}

interface PayStubsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: PayStubEntry[];
  periodStart: string;
  periodEnd: string;
  runDate: string;
  companyName?: string;
  ytdByEmployee?: Record<string, YtdTotals>;
}

export default function PayStubsDialog({
  open,
  onOpenChange,
  entries,
  periodStart,
  periodEnd,
  runDate,
  companyName = "MCR Ledger",
  ytdByEmployee = {},
}: PayStubsDialogProps) {
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    const content = printRef.current;
    if (!content) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    printWindow.document.write(`<!DOCTYPE html><html><head><title>Pay Stubs</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Courier New', monospace; font-size: 11px; color: #000; background: #fff; }
        .stub { page-break-after: always; padding: 24px; border: 1px dashed #999; margin-bottom: 16px; max-width: 720px; }
        .stub:last-child { page-break-after: auto; }
        .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 12px; }
        .header h1 { font-size: 16px; font-weight: bold; }
        .header p { font-size: 11px; color: #444; }
        .info-row { display: flex; justify-content: space-between; margin-bottom: 4px; }
        .section { margin: 12px 0; }
        .section-title { font-weight: bold; font-size: 12px; border-bottom: 1px solid #000; padding-bottom: 2px; margin-bottom: 6px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { text-align: left; padding: 3px 6px; }
        th { font-weight: bold; border-bottom: 1px solid #999; }
        .right { text-align: right; }
        .total-row { border-top: 2px solid #000; font-weight: bold; font-size: 13px; }
        .net-box { background: #f0f0f0; padding: 8px 12px; margin-top: 12px; display: flex; justify-content: space-between; font-size: 14px; font-weight: bold; border: 1px solid #000; }
        .ytd-section { margin-top: 14px; padding-top: 8px; border-top: 1px solid #999; }
        .ytd-section .section-title { color: #555; }
        .tear-line { border-top: 2px dashed #999; margin: 16px 0; text-align: center; font-size: 9px; color: #999; padding-top: 4px; }
        @media print {
          .stub { border: none; margin: 0; padding: 16px 24px; }
          .tear-line { display: block; }
        }
      </style></head><body>`);

    for (const entry of entries) {
      const emp = entry.employees;
      const empId = entry.employee_id || "";
      const totalDeductions = entry.fed_tax + entry.state_tax + (entry.ss_tax || 0) + (entry.medicare_tax || 0) + (entry.sdi_tax || 0);
      const ytd = ytdByEmployee[empId];

      printWindow.document.write(`
        <div class="stub">
          <div class="header">
            <h1>${companyName}</h1>
            <p>EARNINGS STATEMENT — NOT NEGOTIABLE</p>
          </div>
          <div class="info-row"><span><strong>Employee:</strong> ${emp?.name || "—"}</span><span><strong>Employee #:</strong> ${emp?.employee_number || "—"}</span></div>
          <div class="info-row"><span><strong>Title:</strong> ${emp?.role || "—"}</span><span><strong>Pay Date:</strong> ${runDate}</span></div>
          <div class="info-row"><span><strong>Period:</strong> ${periodStart} to ${periodEnd}</span></div>

          <div class="section">
            <div class="section-title">EARNINGS</div>
            <table>
              <tr><th>Description</th><th class="right">Hours</th><th class="right">Current</th>${ytd ? '<th class="right">YTD</th>' : ""}</tr>
              <tr><td>Regular Pay</td><td class="right">${entry.hours_worked.toFixed(1)}</td><td class="right">${fmt(entry.gross_pay)}</td>${ytd ? `<td class="right">${fmt(ytd.gross)}</td>` : ""}</tr>
              <tr class="total-row"><td>Gross Pay</td><td class="right">${ytd ? ytd.hours.toFixed(1) : ""}</td><td class="right">${fmt(entry.gross_pay)}</td>${ytd ? `<td class="right">${fmt(ytd.gross)}</td>` : ""}</tr>
            </table>
          </div>

          <div class="section">
            <div class="section-title">DEDUCTIONS</div>
            <table>
              <tr><th>Description</th><th class="right">Current</th>${ytd ? '<th class="right">YTD</th>' : ""}</tr>
              <tr><td>Federal Income Tax</td><td class="right">${fmt(entry.fed_tax)}</td>${ytd ? `<td class="right">${fmt(ytd.fed_tax)}</td>` : ""}</tr>
              <tr><td>State Income Tax</td><td class="right">${fmt(entry.state_tax)}</td>${ytd ? `<td class="right">${fmt(ytd.state_tax)}</td>` : ""}</tr>
              <tr><td>Social Security</td><td class="right">${fmt(entry.ss_tax || 0)}</td>${ytd ? `<td class="right">${fmt(ytd.ss_tax)}</td>` : ""}</tr>
              <tr><td>Medicare</td><td class="right">${fmt(entry.medicare_tax || 0)}</td>${ytd ? `<td class="right">${fmt(ytd.medicare_tax)}</td>` : ""}</tr>
              <tr><td>CA SDI</td><td class="right">${fmt(entry.sdi_tax || 0)}</td>${ytd ? `<td class="right">${fmt(ytd.sdi_tax)}</td>` : ""}</tr>
              <tr class="total-row"><td>Total Deductions</td><td class="right">${fmt(totalDeductions)}</td>${ytd ? `<td class="right">${fmt(ytd.fed_tax + ytd.state_tax + ytd.ss_tax + ytd.medicare_tax + ytd.sdi_tax)}</td>` : ""}</tr>
            </table>
          </div>

          <div class="net-box">
            <span>NET PAY</span>
            <span>${fmt(entry.net_pay)}${ytd ? `  (YTD: ${fmt(ytd.net)})` : ""}</span>
          </div>

          <div class="tear-line">✂ — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — ✂</div>
        </div>
      `);
    }

    printWindow.document.write("</body></html>");
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 300);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Pay Stubs — {periodStart} to {periodEnd}</span>
            <Button size="sm" onClick={handlePrint}>
              <Printer className="w-4 h-4 mr-2" />Print All
            </Button>
          </DialogTitle>
        </DialogHeader>

        <div ref={printRef} className="space-y-6 py-4">
          {entries.map((entry) => {
            const emp = entry.employees;
            const empId = entry.employee_id || "";
            const totalDeductions = entry.fed_tax + entry.state_tax + (entry.ss_tax || 0) + (entry.medicare_tax || 0) + (entry.sdi_tax || 0);
            const ytd = ytdByEmployee[empId];
            const ytdDeductions = ytd ? ytd.fed_tax + ytd.state_tax + ytd.ss_tax + ytd.medicare_tax + ytd.sdi_tax : 0;

            return (
              <div key={entry.id} className="border border-border rounded-lg p-5 bg-card">
                <div className="text-center border-b border-border pb-2 mb-3">
                  <h3 className="font-display font-bold text-lg text-card-foreground">{companyName}</h3>
                  <p className="text-xs text-muted-foreground">EARNINGS STATEMENT</p>
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm mb-4">
                  <p className="text-card-foreground"><span className="font-semibold">Employee:</span> {emp?.name || "—"}</p>
                  <p className="text-card-foreground"><span className="font-semibold">Employee #:</span> {emp?.employee_number || "—"}</p>
                  <p className="text-card-foreground"><span className="font-semibold">Title:</span> {emp?.role || "—"}</p>
                  <p className="text-card-foreground"><span className="font-semibold">Pay Date:</span> {runDate}</p>
                  <p className="text-card-foreground"><span className="font-semibold">Period:</span> {periodStart} to {periodEnd}</p>
                </div>

                {/* Earnings */}
                <div className="mb-3">
                  <h4 className="text-xs font-semibold text-muted-foreground border-b border-border pb-1 mb-2">EARNINGS</h4>
                  <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 text-sm">
                    <span className="text-muted-foreground text-xs"></span>
                    <span className="text-xs text-muted-foreground text-right font-semibold">Current</span>
                    {ytd && <span className="text-xs text-muted-foreground text-right font-semibold">YTD</span>}
                  </div>
                  <div className={`grid ${ytd ? "grid-cols-[1fr_auto_auto]" : "grid-cols-[1fr_auto]"} gap-x-4 text-sm text-card-foreground`}>
                    <span>Regular Pay ({entry.hours_worked.toFixed(1)} hrs)</span>
                    <span className="font-mono text-right">{fmt(entry.gross_pay)}</span>
                    {ytd && <span className="font-mono text-right">{fmt(ytd.gross)}</span>}
                  </div>
                  <div className={`grid ${ytd ? "grid-cols-[1fr_auto_auto]" : "grid-cols-[1fr_auto]"} gap-x-4 text-sm font-semibold text-card-foreground border-t border-border mt-1 pt-1`}>
                    <span>Gross Pay</span>
                    <span className="font-mono text-right">{fmt(entry.gross_pay)}</span>
                    {ytd && <span className="font-mono text-right">{fmt(ytd.gross)}</span>}
                  </div>
                </div>

                {/* Deductions */}
                <div className="mb-3">
                  <h4 className="text-xs font-semibold text-muted-foreground border-b border-border pb-1 mb-2">DEDUCTIONS</h4>
                  <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 text-sm">
                    <span className="text-muted-foreground text-xs"></span>
                    <span className="text-xs text-muted-foreground text-right font-semibold">Current</span>
                    {ytd && <span className="text-xs text-muted-foreground text-right font-semibold">YTD</span>}
                  </div>
                  <div className="space-y-0.5 text-sm">
                    <div className={`grid ${ytd ? "grid-cols-[1fr_auto_auto]" : "grid-cols-[1fr_auto]"} gap-x-4 text-card-foreground`}>
                      <span>Federal Income Tax</span>
                      <span className="font-mono text-right text-destructive">{fmt(entry.fed_tax)}</span>
                      {ytd && <span className="font-mono text-right text-destructive">{fmt(ytd.fed_tax)}</span>}
                    </div>
                    <div className={`grid ${ytd ? "grid-cols-[1fr_auto_auto]" : "grid-cols-[1fr_auto]"} gap-x-4 text-card-foreground`}>
                      <span>State Income Tax</span>
                      <span className="font-mono text-right text-destructive">{fmt(entry.state_tax)}</span>
                      {ytd && <span className="font-mono text-right text-destructive">{fmt(ytd.state_tax)}</span>}
                    </div>
                    <div className={`grid ${ytd ? "grid-cols-[1fr_auto_auto]" : "grid-cols-[1fr_auto]"} gap-x-4 text-card-foreground`}>
                      <span>Social Security</span>
                      <span className="font-mono text-right text-destructive">{fmt(entry.ss_tax || 0)}</span>
                      {ytd && <span className="font-mono text-right text-destructive">{fmt(ytd.ss_tax)}</span>}
                    </div>
                    <div className={`grid ${ytd ? "grid-cols-[1fr_auto_auto]" : "grid-cols-[1fr_auto]"} gap-x-4 text-card-foreground`}>
                      <span>Medicare</span>
                      <span className="font-mono text-right text-destructive">{fmt(entry.medicare_tax || 0)}</span>
                      {ytd && <span className="font-mono text-right text-destructive">{fmt(ytd.medicare_tax)}</span>}
                    </div>
                    <div className={`grid ${ytd ? "grid-cols-[1fr_auto_auto]" : "grid-cols-[1fr_auto]"} gap-x-4 text-card-foreground`}>
                      <span>CA SDI</span>
                      <span className="font-mono text-right text-destructive">{fmt(entry.sdi_tax || 0)}</span>
                      {ytd && <span className="font-mono text-right text-destructive">{fmt(ytd.sdi_tax)}</span>}
                    </div>
                  </div>
                  <div className={`grid ${ytd ? "grid-cols-[1fr_auto_auto]" : "grid-cols-[1fr_auto]"} gap-x-4 text-sm font-semibold text-card-foreground border-t border-border mt-1 pt-1`}>
                    <span>Total Deductions</span>
                    <span className="font-mono text-right text-destructive">{fmt(totalDeductions)}</span>
                    {ytd && <span className="font-mono text-right text-destructive">{fmt(ytdDeductions)}</span>}
                  </div>
                </div>

                {/* Net Pay */}
                <div className="bg-muted rounded-md px-4 py-2 flex justify-between items-center">
                  <span className="font-display font-bold text-card-foreground">NET PAY</span>
                  <div className="text-right">
                    <span className="font-mono font-bold text-lg text-card-foreground">{fmt(entry.net_pay)}</span>
                    {ytd && <span className="block font-mono text-xs text-muted-foreground">YTD: {fmt(ytd.net)}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
