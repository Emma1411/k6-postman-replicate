import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

/** Thème sombre bleu : les couleurs de fond et de texte viennent des variables CSS de l'application. */
export const editorTheme: Extension = [
  EditorView.theme(
    {
      "&": { backgroundColor: "transparent", color: "var(--foreground)", fontSize: "13px" },
      ".cm-content": { caretColor: "var(--primary)", fontFamily: "var(--font-geist-mono), ui-monospace, monospace" },
      ".cm-cursor": { borderLeftColor: "var(--primary)" },
      ".cm-gutters": { backgroundColor: "transparent", color: "var(--muted-foreground)", border: "none" },
      ".cm-activeLine": { backgroundColor: "color-mix(in oklab, var(--accent) 55%, transparent)" },
      ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--foreground)" },
      "&.cm-focused": { outline: "none" },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
        backgroundColor: "color-mix(in oklab, var(--ring) 35%, transparent)",
      },
      ".cm-scroller": { lineHeight: "1.6" },
    },
    { dark: true },
  ),
  syntaxHighlighting(
    HighlightStyle.define([
      { tag: [t.propertyName, t.attributeName], color: "#bfdbfe" },
      { tag: t.string, color: "#8ed0ff" },
      { tag: [t.number, t.integer, t.float], color: "#3fb68b" },
      { tag: [t.bool, t.null, t.keyword], color: "#e5a93d" },
      { tag: [t.tagName, t.angleBracket], color: "#60a5fa" },
      { tag: [t.punctuation, t.separator, t.brace, t.squareBracket], color: "#6b7f9e" },
      { tag: t.comment, color: "#6b7f9e", fontStyle: "italic" },
    ]),
  ),
];