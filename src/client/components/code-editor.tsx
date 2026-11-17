"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/client/components/ui/skeleton";

export type CodeLanguage = "json" | "xml" | "text";

export interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  language?: CodeLanguage;
  readOnly?: boolean;
  minHeight?: string;
  maxHeight?: string;
  ariaLabel?: string;
}

// CodeMirror n'existe que dans le navigateur : il est chargé à la demande.
const Inner = dynamic(() => import("./code-editor-inner"), {
  ssr: false,
  loading: () => <Skeleton className="h-40 w-full" />,
});

export function CodeEditor(props: CodeEditorProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      <Inner {...props} />
    </div>
  );
}