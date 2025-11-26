import React, { useEffect, useRef, useState, useMemo } from "react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";

import { getPaginationPages } from "./plugins/paginationPlugin";

type PageInfo = {
  pageIndex: number;
  start: number;
  end: number;
};

const PAGE_BUFFER = 1;

export function VirtualizedEditor({ editor }: { editor: Editor | null }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const liveEditorRef = useRef<HTMLDivElement | null>(null);

  const [pages, setPages] = useState<PageInfo[]>([]);
  const [visiblePages, setVisiblePages] = useState<number[]>([]);
  const [activePage, setActivePage] = useState<number | null>(1);

  /* -------------------------------------------------------------
   * 1) Subscribe to pagination plugin updates
   * ------------------------------------------------------------- */
  useEffect(() => {
    if (!editor) return;

    const updatePages = () => {
      const pg = getPaginationPages(editor.state) || [];
      setPages(pg);

      const cursor = editor.state.selection.from;
      const found = pg.find((p : PageInfo) => cursor >= p.start && cursor < p.end);
      if (found) setActivePage(found.pageIndex);
    };

    updatePages();
    editor.on("update", updatePages);
    editor.on("update", ({ editor }) => {
        const html = editor.getHTML();
        localStorage.setItem('editor', JSON.stringify(html));
      });
    return () => {
      editor.off("update", updatePages);
    };
  }, [editor]);

  /* -------------------------------------------------------------
   * 2) Detect which pages are visible (scroll-based virtualization)
   * ------------------------------------------------------------- */
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const computeVisible = () => {
      const viewport = container.getBoundingClientRect();
      const children = Array.from(
        container.querySelectorAll(".vpage")
      ) as HTMLElement[];

      const visible: number[] = [];
      children.forEach((child) => {
        const rect = child.getBoundingClientRect();
        if (rect.bottom >= viewport.top - 60 && rect.top <= viewport.bottom + 60) {
          visible.push(Number(child.dataset.pageIndex));
        }
      });

      if (visible.length) {
        setVisiblePages(visible);
        if (!visible.includes(activePage!)) {
          setActivePage(visible[0]);
        }
      }
    };

    computeVisible();
    container.addEventListener("scroll", computeVisible, { passive: true });
    window.addEventListener("resize", computeVisible);

    return () => {
      container.removeEventListener("scroll", computeVisible);
      window.removeEventListener("resize", computeVisible);
    };
  }, [pages, activePage]);

  /* -------------------------------------------------------------
   * 3) Compute which pages to actually render (visible ± buffer)
   * ------------------------------------------------------------- */
  const pagesToRender = useMemo(() => {
    if (!visiblePages.length) return pages.slice(0, 3);
    const minV = Math.min(...visiblePages);
    const maxV = Math.max(...visiblePages);
    const from = Math.max(1, minV - PAGE_BUFFER);
    const to = Math.min(pages.length, maxV + PAGE_BUFFER);
    return pages.slice(from - 1, to);
  }, [pages, visiblePages]);

  /* -------------------------------------------------------------
   * 4) Position the live EditorContent over the active page
   * ------------------------------------------------------------- */
  useEffect(() => {
    if (!editor) return;

    const live = liveEditorRef.current;
    const scrollContainer = scrollRef.current;
    if (!live || !scrollContainer) return;

    const activeDom = scrollContainer.querySelector(
      `[data-page-index="${activePage}"]`
    ) as HTMLElement;

    if (!activeDom) return;

    const containerRect = scrollContainer.getBoundingClientRect();
    const pageRect = activeDom.getBoundingClientRect();

    const top = pageRect.top - containerRect.top + scrollContainer.scrollTop + 48;
    const left = pageRect.left - containerRect.left + scrollContainer.scrollLeft + 48;

    live.style.transform = `translate(${left}px, ${top}px)`;
  }, [activePage, pagesToRender]);

  /* -------------------------------------------------------------
   * 5) Render a static virtual page
   * ------------------------------------------------------------- */
  // const renderStaticPage = (page: PageInfo) => {
  //   const html = serializeRangeToHTML(
  //     editor!.schema,
  //     editor!.state.doc,
  //     page.start,
  //     page.end
  //   );

  //   return (
  //     <div
  //       key={page.pageIndex}
  //       className="vpage"
  //       data-page-index={page.pageIndex}
  //       style={pageStyle}
  //       onClick={() => {
  //         editor?.chain().focus().setTextSelection(page.start).run();
  //         setActivePage(page.pageIndex);
  //       }}
  //       dangerouslySetInnerHTML={{ __html: html }}
  //     />
  //   );
  // };

  /* -------------------------------------------------------------
   * 6) Render page list + floating editor
   * ------------------------------------------------------------- */
  return (
    <div ref={scrollRef} style={scrollContainerStyle}>
      {/* <div style={pagesWrapperStyle}>
        {pagesToRender.map((p) => renderStaticPage(p))}
      </div> */}

      {/* The real TipTap EditorContent (never unmounted) */}
      <div ref={liveEditorRef} style={liveEditorContainerStyle}>
        <EditorContent editor={editor!} />
        <div id="editor-block-ui" />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------
 * Styles
 * ------------------------------------------------------------- */
const scrollContainerStyle: React.CSSProperties = {
  width: "100%",
  height: "100vh",
  overflowY: "auto",
  display: "flex",
  justifyContent: "center",
  position: "relative",
};

// const pagesWrapperStyle: React.CSSProperties = {
//   display: "flex",
//   flexDirection: "column",
//   gap: "48px",
//   paddingTop: "40px",
// };

// const pageStyle: React.CSSProperties = {
//   width: "680px",
//   minHeight: "900px",
//   background: "white",
//   color: "black",
//   padding: "48px",
//   boxShadow: "0 0 8px rgba(0,0,0,0.2)",
//   borderRadius: "4px",
//   boxSizing: "border-box",
// };

const liveEditorContainerStyle: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  pointerEvents: "auto",
  width: "680px",
};
