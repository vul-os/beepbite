import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Copy, Check, Printer } from 'lucide-react';

/**
 * CardResult — shown after a successful POST /gift-cards/issue.
 *
 * Props:
 *   result: { id, masked_code }   — IssueResult from backend
 *   onDismiss: () => void         — called when user clicks "Issue Another"
 */
export function CardResult({ result, onDismiss }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(result.masked_code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handlePrint() {
    window.print();
  }

  return (
    <Card className="border-green-200 bg-green-50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-green-800 text-base">Gift Card Issued</CardTitle>
          <Badge variant="outline" className="border-green-400 text-green-700">
            Active
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-xs text-muted-foreground mb-1">Card Code</p>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xl font-bold tracking-widest text-green-900">
              {result.masked_code}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleCopy}
              title="Copy code"
            >
              {copied ? (
                <Check className="h-4 w-4 text-green-600" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Card ID: <span className="font-mono">{result.id}</span>
        </p>

        <div className="flex gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-1" />
            Print
          </Button>
          <Button type="button" size="sm" onClick={onDismiss}>
            Issue Another
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
