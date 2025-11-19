// src/plugins/paginationPlugin.ts
import { EditorState, Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { DOMSerializer, Schema, Node as ProseMirrorNode } from "prosemirror-model";
import { findParentNode } from 'prosemirror-utils';

export const paginationKey = new PluginKey("paginationPlugin");

const PAGE_HEIGHT = 800;
const PAGE_HEADER_HEIGHT = 60;
const DEFAULT_PAGE_WIDTH = 650;
let decorationCache: any;
let heightCache: any;

/** Ensure a hidden measurement div exists inside editorEl (or document.body) */
// function ensureMeasureDiv(editorEl: HTMLElement | null, width: number) {
//   let el: HTMLElement | null = null;
//   if (editorEl) el = editorEl.querySelector("#pm-measure") as HTMLElement;
//   if (!el) {
//     el = document.createElement("div");
//     el.id = "pm-measure";
//     el.style.cssText = [
//       "position: absolute",
//       "left: -9999px",
//       "top: 0",
//       "visibility: hidden",
//       "padding: 0",
//       "margin: 0",
//       "white-space: normal",
//       "box-sizing: border-box",
//     ].join(";");
//     (editorEl || document.body).appendChild(el);
//   }
//   el.style.width = (width || DEFAULT_PAGE_WIDTH) + "px";
//   return el;
// }

function measureNodeHeight(serializer: DOMSerializer, node: ProseMirrorNode, width: number) {
    // 1. Create measurement container once
    let measureDiv = document.getElementById("pm-measure-div") as HTMLElement | null;
    if (!measureDiv) {
      measureDiv = document.createElement("div");
      measureDiv.id = "pm-measure-div";
      measureDiv.style.position = "absolute";
      measureDiv.style.visibility = "hidden";
      measureDiv.style.pointerEvents = "none";
      measureDiv.style.left = "-9999px";
      measureDiv.style.top = "0";
      measureDiv.style.width = width + "px";
      document.body.appendChild(measureDiv); // IMPORTANT: OUTSIDE EDITOR
    }
  
    // 2. Serialize and CLONE node safely
    const dom = serializer.serializeNode(node);
    const cloned = dom.cloneNode(true) as HTMLElement;
  
    // 3. Clean container and insert clone for measurement
    measureDiv.innerHTML = "";
    measureDiv.appendChild(cloned);
  
    // 4. Measure height
    const height = measureDiv.offsetHeight;
  
    return height;
}

function pageBreakWidget(pageNumber: number, freeSpace: number) {
  const div = document.createElement("div");
  div.className = "pagebreak";
  div.style.marginTop = `${freeSpace + PAGE_HEADER_HEIGHT}px`;
  div.style.color = "red";
  const header = document.createElement("div");
  header.className = "pageheader";
  header.setAttribute("contenteditable", "false");
  header.textContent = String(pageNumber);
  div.appendChild(header);
  return div;
}

export function createPaginationPlugin(schema: Schema, opts?: { editorSelector?: string }) {
  const serializer = DOMSerializer.fromSchema(schema);
  const editorSelector = (opts && opts.editorSelector) || ".ProseMirror";

  return new Plugin({
    key: paginationKey,

    state: {
      init() {
        return {
          decorations: DecorationSet.empty,
          heightUpdates: [] as { pos: number; height: number }[],
        };
      },

    apply(tr, prev, oldState, newState) {
      
      if(!tr.docChanged && !(tr.getMeta(paginationKey) && tr.getMeta(paginationKey).force)) {
        return {
          decorations: decorationCache,
          heightUpdates: heightCache,
        };
      }
      if(newState.doc.textContent == "") {
        return {
        decorations: DecorationSet.empty,
        heightUpdates: [] as { pos: number; height: number }[],
      };
      }
      // if(heightCache){
      //   const parentNodeObj = findParentNode(n => {
      //        return n.type.name.toLowerCase() == 'paragraph';
      //      })(newState.selection);
      //      const paragraphNodeHeight = parentNodeObj?.node.attrs.height || 0;
      //      const paragraphNodePos = parentNodeObj?.pos || 0;
      //      const heightFromCache = heightCache.find((h: { pos: number; height: number }) => h.pos === paragraphNodePos);
      //  if(paragraphNodeHeight == heightFromCache.height) {
      //    return {
      //      decorations: decorationCache,
      //      heightUpdates: heightCache,
      //    };
      //  }
      // }
        // Start timing pagination
        const startTime = performance.now();
        
        //console.log(prev);
        //console.log(oldState);
        const meta = tr.getMeta(paginationKey) || {};
        const force = !!meta.force;
      
        const editorEl = document.querySelector(editorSelector) as HTMLElement | null;
        const editorWidth = editorEl ? editorEl.clientWidth : DEFAULT_PAGE_WIDTH;
      
        const decorations: Decoration[] = [];
        const heightUpdates: { pos: number; height: number }[] = [];
      
        // 1. Detect which paragraphs changed in this transaction
        const changedPositions: number[] = [];
        if (tr.docChanged) {
          tr.steps.forEach(step => {
            const map = step.getMap();
            map.forEach(( newStart, newEnd) => {
              newState.doc.nodesBetween(newStart, newEnd, (node, pos) => {
                if (node.type.name === "paragraph") {
                  changedPositions.push(pos);
                }
              });
            });
          });
        }
      
        // Cursor position for determining which paragraph is active
        const selectionFrom = newState.selection.from;
        const selectionTo = newState.selection.to;
      
        // Pagination accumulators
        let pageNum = 1;
        let pageTop = 0;
        let lastBottom = 0;
        const pageBreakPositions: number[] = [];
        // 2. Traverse document paragraphs
        newState.doc.descendants((node, pos) => {
          if (node.type.name !== "paragraph") return;
      
          // --- HEIGHT RECALCULATION LOGIC ---
          let shouldMeasure = false;
      
          // (1) height missing
          if (!node.attrs.height || node.attrs.height <= 0) {
            shouldMeasure = true;
          }
      
          // (2) cursor inside this paragraph → must remeasure live while typing
          const cursorInside =
            (selectionFrom >= pos && selectionFrom <= pos + node.nodeSize) ||
            (selectionTo >= pos && selectionTo <= pos + node.nodeSize);
      
          if (cursorInside) {
            shouldMeasure = true;
          }
      
          // (3) this paragraph changed in this transaction
          if (changedPositions.includes(pos)) {
            shouldMeasure = true;
          }
      
          // (4) external force pagination call
          if (force) {
            shouldMeasure = true;
          }
      
          let height: number;
      
          if (shouldMeasure) {
            height = measureNodeHeight(serializer, node, editorWidth);
            if(height != node.attrs.width){
              heightUpdates.push({ pos, height });
            }
          } else {
            height = node.attrs.height;
          }
      
          // --- PAGINATION LOGIC ---
          const top = lastBottom;
          const bottom = top + height;
          const bottomRel = bottom - pageTop;
      
          if (bottomRel > PAGE_HEIGHT) {
            const freeSpace = PAGE_HEIGHT - (lastBottom - pageTop);
      
            // Freeze pageIndex so widget doesn't capture a stale one
            const pageIndex = pageNum + 1;
            pageBreakPositions.push(pos);
            decorations.push(
              Decoration.widget(
                pos,
                () => pageBreakWidget(pageIndex, freeSpace),
                {
                  key: `pagebreak-${pageIndex}`,
                  side: 1,
                }
              )
            );
      
            pageNum++;
            pageTop = lastBottom;
          }
      
          lastBottom = bottom;
        });
      
        // 3. Build decoration set AFRESH (do not reuse old ones)
        const decoSet = DecorationSet.create(newState.doc, decorations);
        const pages: { pageIndex: number; start: number; end: number }[] = [];
        let curStart = 0;
        let pageIndex = 1;
        for (const br of pageBreakPositions) { // pageBreakPositions is list of pos where break inserted
          pages.push({ pageIndex, start: curStart, end: br });
          curStart = br;
          pageIndex++;
        }
        // last page
        pages.push({ pageIndex, start: curStart, end: newState.doc.content.size });
        
        // End timing and calculate duration
        const endTime = performance.now();
        const durationSeconds = (endTime - startTime) / 1000;
        console.log(`Pagination completed in ${durationSeconds.toFixed(4)} seconds`);
        decorationCache = decoSet;
        heightCache = heightUpdates;
        // Return updated plugin state
        return {
          decorations: decoSet,
          heightUpdates
        };
      }
      
    },

    appendTransaction(_, oldState, newState) {
        //console.log(oldState);
      const pluginState = paginationKey.getState(newState) as any;
      if (!pluginState) return null;

      const updates: { pos: number; height: number }[] = pluginState.heightUpdates || [];
      if (!updates.length) return null;

      const tr = newState.tr;
      let changed = false;

      updates.forEach(({ pos, height }) => {
        const mapped = tr.mapping.map(pos, -1);
        const node = newState.doc.nodeAt(mapped);
        if (!node) return;
        if (node.attrs.height !== height && node.type.name === "paragraph") {
          tr.setNodeMarkup(mapped, undefined, { ...node.attrs, height });
          changed = true;
        }
      });

      return changed ? tr : null;
    },

    props: {
      decorations(state) {
        const s = paginationKey.getState(state) as any;
        return s ? s.decorations : DecorationSet.empty;
      },
    },
  });
}

/** Helper to force recompute */
export function forcePagination(view: { state: any; dispatch: (tr: any) => void }) {
  const tr = view.state.tr.setMeta(paginationKey, { force: true });
  view.dispatch(tr);
}
export function getPaginationPages(state : EditorState) {
  return paginationKey.getState(state)?.pages ?? [];
}