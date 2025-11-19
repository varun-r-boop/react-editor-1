// src/App.tsx
import React from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { ParagraphExtension } from "./extensions/ParagraphExtension";
import "./dark-screenplay.css";
import "./pagination.css";
import { forcePagination } from "./plugins/paginationPlugin";
import { VirtualizedEditor } from "./VirtualizedEditor";

export default function App() {
  const editor = useEditor({
    extensions: [StarterKit.configure({ paragraph: false }), ParagraphExtension],
    content: JSON.parse(window.localStorage.getItem('editor') || 'null'),
  });

  React.useEffect(() => {
    if (editor) forcePagination(editor.view);
  }, [editor]);

  return (
    <div className="dark-editor-shell">
      <div className="dark-editor-area">
  <div className="page-wrapper">
    <VirtualizedEditor editor={editor}  />
  </div>
</div>

    </div>
  );
}