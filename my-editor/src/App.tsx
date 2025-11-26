// src/App.tsx
import React from "react";
import { useEditor } from "@tiptap/react";
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

  const handleInsertSceneHeader = (prefill?: string) => {
    if (!editor) return;
    editor.chain().focus().insertSceneHeader(prefill).run();
  };

  React.useEffect(() => {
    if (editor) forcePagination(editor.view);
  }, [editor]);

  const sceneHeaderButtons = React.useMemo(
    () => [
      {
        id: "scene-generic",
        label: "Scene",
        description: "Insert blank scene header",
        prefill: undefined,
        Icon: ClapperIcon,
      },
      {
        id: "scene-int",
        label: "INT.",
        description: "Insert interior scene header",
        prefill: "INT. ",
        Icon: InteriorIcon,
      },
      {
        id: "scene-ext",
        label: "EXT.",
        description: "Insert exterior scene header",
        prefill: "EXT. ",
        Icon: ExteriorIcon,
      },
    ],
    []
  );

  return (
    <div className="dark-editor-shell">
      <div className="dark-editor-area">
        <div className="dark-editor-toolbar" role="toolbar" aria-label="Scene header insertion">
          {sceneHeaderButtons.map(({ id, label, description, prefill, Icon }) => (
            <button
              key={id}
              type="button"
              className="toolbar-icon-button"
              aria-label={description}
              onClick={() => handleInsertSceneHeader(prefill)}
              disabled={!editor}
            >
              <Icon />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div className="page-wrapper">
          <VirtualizedEditor editor={editor} />
        </div>
      </div>

    </div>
  );
}

function ClapperIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 8v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8H3zm16 2v10H5V10h14zM5 2l-.86 3H20l.86-3H5zm5.5 1 1 2h2l-1-2h-2zm-4 0 1 2h2l-1-2h-2z" />
    </svg>
  );
}

function InteriorIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 3h16a1 1 0 0 1 1 1v16h-2V5H5v15H3V4a1 1 0 0 1 1-1zm3 6h10v11H7V9zm2 2v7h2v-7H9zm4 0v7h2v-7h-2z" />
    </svg>
  );
}

function ExteriorIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2 2 9h3v11h5v-6h4v6h5V9h3L12 2zm0 2.3 4.74 3.4H7.26L12 4.3z" />
    </svg>
  );
}