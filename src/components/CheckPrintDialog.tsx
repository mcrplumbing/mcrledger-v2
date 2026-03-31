import { useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, Download } from "lucide-react";

interface CheckData {
  date: string;
  payee: string;
  amount: number;
  memo: string;
  checkNo: string;
  bankName: string;
  accountName: string;
  routingNumber: string;
  accountNumber: string;
}

function numberToWords(n: number): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  
  if (n === 0) return "Zero";
  const dollars = Math.floor(n);
  const cents = Math.round((n - dollars) * 100);
  
  function convert(num: number): string {
    if (num < 20) return ones[num];
    if (num < 100) return tens[Math.floor(num / 10)] + (num % 10 ? " " + ones[num % 10] : "");
    if (num < 1000) return ones[Math.floor(num / 100)] + " Hundred" + (num % 100 ? " " + convert(num % 100) : "");
    if (num < 1000000) return convert(Math.floor(num / 1000)) + " Thousand" + (num % 1000 ? " " + convert(num % 1000) : "");
    return convert(Math.floor(num / 1000000)) + " Million" + (num % 1000000 ? " " + convert(num % 1000000) : "");
  }
  
  return convert(dollars) + " and " + String(cents).padStart(2, "0") + "/100";
}

export default function CheckPrintDialog({
  open, onOpenChange, checks
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  checks: CheckData[];
}) {
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    const content = printRef.current;
    if (!content) return;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
      <html><head><title>Print Checks</title>
      <style>
        @page { size: letter; margin: 0; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Courier New', monospace; }
        .check-page { width: 8.5in; height: 11in; padding: 0.25in; display: flex; flex-direction: column; gap: 0; page-break-after: always; }
        .check-voucher { height: 3.5in; border: 1px dashed #ccc; padding: 0.3in; display: flex; flex-direction: column; }
        .check-main { flex: 1; position: relative; }
        .check-header { display: flex; justify-content: space-between; margin-bottom: 0.15in; }
        .bank-info { font-size: 9pt; color: #666; }
        .check-no { font-size: 11pt; font-weight: bold; }
        .date-line { text-align: right; margin-bottom: 0.1in; font-size: 10pt; }
        .pay-to { margin: 0.15in 0; font-size: 10pt; }
        .pay-to .label { font-size: 8pt; color: #888; }
        .pay-to .value { font-size: 12pt; font-weight: bold; border-bottom: 1px solid #333; padding-bottom: 2px; }
        .amount-box { position: absolute; right: 0; top: 0.45in; border: 2px solid #333; padding: 4px 12px; font-size: 14pt; font-weight: bold; }
        .written-amount { font-size: 9pt; border-bottom: 1px solid #333; padding: 4px 0; margin: 0.1in 0; }
        .memo-line { font-size: 9pt; margin-top: auto; display: flex; justify-content: space-between; }
        .memo-line .label { color: #888; font-size: 7pt; }
        .stub { padding: 0.15in; border-top: 1px dashed #aaa; }
        .stub-row { display: flex; justify-content: space-between; font-size: 8pt; padding: 2px 0; }
        .stub-header { font-weight: bold; border-bottom: 1px solid #ddd; margin-bottom: 4px; }
        .micr { font-family: 'MICR', 'Courier New', monospace; font-size: 11pt; text-align: center; margin-top: 0.1in; letter-spacing: 3px; color: #333; }
      </style></head><body>
    `);
    
    // Print checks 3-per-page
    for (let page = 0; page < Math.ceil(checks.length / 3); page++) {
      win.document.write('<div class="check-page">');
      for (let i = page * 3; i < Math.min((page + 1) * 3, checks.length); i++) {
        const c = checks[i];
        const fmt = `$${c.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
        win.document.write(`
          <div class="check-voucher">
            <div class="check-main">
              <div class="check-header">
                <div class="bank-info">${c.accountName}<br/>${c.bankName}</div>
                <div class="check-no">No. ${c.checkNo}</div>
              </div>
              <div class="date-line">Date: ${c.date}</div>
              <div class="pay-to">
                <div class="label">PAY TO THE ORDER OF</div>
                <div class="value">${c.payee}</div>
              </div>
              <div class="amount-box">${fmt}</div>
              <div class="written-amount">${numberToWords(c.amount)} *** DOLLARS</div>
              <div class="memo-line">
                <div><span class="label">MEMO</span> ${c.memo}</div>
                <div>________________________</div>
              </div>
              <div class="micr">⑈${c.routingNumber}⑈ ${c.accountNumber}⑆ ${c.checkNo}</div>
            </div>
            <div class="stub">
              <div class="stub-row stub-header">
                <span>Check #${c.checkNo}</span><span>${c.date}</span><span>${fmt}</span>
              </div>
              <div class="stub-row"><span>Payee: ${c.payee}</span></div>
              <div class="stub-row"><span>Memo: ${c.memo}</span></div>
            </div>
          </div>
        `);
      }
      win.document.write('</div>');
    }
    
    win.document.write('</body></html>');
    win.document.close();
    setTimeout(() => win.print(), 300);
  };

  const handlePDF = () => {
    // Use same print flow but let user "Save as PDF" from print dialog
    handlePrint();
  };

  if (checks.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Print Checks ({checks.length})</DialogTitle>
        </DialogHeader>
        
        <div ref={printRef} className="space-y-4 max-h-[60vh] overflow-y-auto">
          {checks.map((c, i) => (
            <div key={i} className="border border-border rounded-lg p-4 bg-card space-y-2">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs text-muted-foreground">{c.accountName} · {c.bankName}</p>
                </div>
                <span className="font-mono font-bold text-card-foreground">#{c.checkNo}</span>
              </div>
              <div className="flex justify-between items-center pt-2">
                <div>
                  <p className="text-xs text-muted-foreground">PAY TO THE ORDER OF</p>
                  <p className="font-semibold text-card-foreground">{c.payee}</p>
                </div>
                <div className="border-2 border-primary rounded px-3 py-1">
                  <span className="font-mono font-bold text-lg text-primary">
                    ${c.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground italic border-b border-border pb-1">
                {numberToWords(c.amount)} DOLLARS
              </p>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Memo: {c.memo}</span>
                <span>Date: {c.date}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-3 pt-4">
          <Button onClick={handlePrint} className="flex-1">
            <Printer className="w-4 h-4 mr-2" />Print Checks
          </Button>
          <Button variant="outline" onClick={handlePDF} className="flex-1">
            <Download className="w-4 h-4 mr-2" />Save as PDF
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
