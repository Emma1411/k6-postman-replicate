"use client";

import { Loader2, Play, X } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/client/components/ui/select";
import type { HttpMethod } from "@/shared/schemas";

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

interface Props {
  method: HttpMethod;
  url: string;
  sending: boolean;
  onMethod: (method: HttpMethod) => void;
  onUrl: (url: string) => void;
  onSend: () => void;
  onCancel: () => void;
}

export function RequestBar({ method, url, sending, onMethod, onUrl, onSend, onCancel }: Props) {
  return (
    <div className="flex flex-wrap gap-2 sm:flex-nowrap">
      <Select value={method} onValueChange={(value) => onMethod(value as HttpMethod)}>
        <SelectTrigger className="w-28 font-mono font-medium" aria-label="Méthode HTTP">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {METHODS.map((m) => (
            <SelectItem key={m} value={m} className="font-mono">
              {m}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        value={url}
        onChange={(e) => onUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) onSend();
        }}
        placeholder="https://api.exemple.com/v1/products ou {{base_url}}/products"
        aria-label="Adresse à appeler"
        spellCheck={false}
        autoComplete="off"
        className="min-w-0 flex-1 font-mono"
      />

      {sending ? (
        <Button type="button" variant="outline" onClick={onCancel} className="gap-2">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Annuler
          <X className="size-4" aria-hidden />
        </Button>
      ) : (
        <Button type="button" onClick={onSend} className="gap-2">
          <Play className="size-4" aria-hidden />
          Envoyer
          <kbd className="ml-1 hidden rounded bg-black/15 px-1.5 py-0.5 font-mono text-[10px] sm:inline">Ctrl+Entrée</kbd>
        </Button>
      )}
    </div>
  );
}