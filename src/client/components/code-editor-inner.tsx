"use client";

import { json } from "@codemirror/lang-json";
import { xml } from "@codemirror/lang-xml";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo } from "react";
import type { CodeEditorProps } from "./code-editor";
import { editorTheme } from "./code-editor-theme";

export default function CodeEditorInner({
  value,
  onChange,
  language = "text",
  readOnly = false,
  minHeight = "160px",
  maxHeight = "480px",
  ariaLabel,
}: CodeEditorProps) {
  const extensions = useMemo(() => {
    const list: Extension[] = [editorTheme, EditorView.lineWrapping];
    if (language === "json") list.push(json());
    if (language === "xml") list.push(xml());
    if (ariaLabel) list.push(EditorView.contentAttributes.of({ "aria-label": ariaLabel }));
    return list;
  }, [language, ariaLabel]);

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      editable={!readOnly}
      readOnly={readOnly}
      theme="none"
      minHeight={minHeight}
      maxHeight={maxHeight}
      basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: !readOnly, autocompletion: false }}
    />
  );
}