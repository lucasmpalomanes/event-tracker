"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

// Copies the Pix copia-e-cola payload (specs/pix-payments.md §7.1).
export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Button variant="outline" size="xs" onClick={copy}>
      {copied ? (
        <>
          <CheckIcon data-icon="inline-start" />
          Copiado
        </>
      ) : (
        <>
          <CopyIcon data-icon="inline-start" />
          Copiar código
        </>
      )}
    </Button>
  );
}
