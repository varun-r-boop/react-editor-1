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
let pageCache: any;

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

function pageBreakWidget(
  pageNumber: number,
  freeSpace: number,
  split?: { topdata: any; bottomdata: any },
  lastCharName?: string
) {
  const container = document.createElement("div");
  container.className = "pagebreak-container";
  container.style.marginTop = `${freeSpace}px`;

  // (MORE) — only when split is present
  if (split) {
    const more = document.createElement("div");
    more.className = "dialogue-more";
    more.textContent = "(MORE)";
    container.appendChild(more);
  }

  // Page break line
  const line = document.createElement("div");
  line.className = "pagebreak-line";
  container.appendChild(line);

  // Page number
  const num = document.createElement("div");
  num.className = "pagebreak-number";
  num.textContent = String(pageNumber);
  container.appendChild(num);

  // CONT’D label on next page
  if (split && lastCharName) {
    const contd = document.createElement("div");
    contd.className = "dialogue-contd";
    contd.textContent = `${lastCharName} (CONT'D)`;
    container.appendChild(contd);
  }

  return container;
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
          pages:[] as { pageIndex: number; start: number; end: number }[]
          
        };
      },

    apply(tr, prev, oldState, newState) {
      
      const meta = tr.getMeta(paginationKey) || {};
      const force = !!meta.force;
       if (!tr.docChanged && !force) 
        {
          return prev;
        }

      // If user is actively typing inside a paragraph we want to avoid
      // replacing page-break decorations (which causes visual jump). Instead
      // keep previous decorations and only emit height updates. We'll set
      // `reuseDecorations` when this case is detected during pagination loop.
      let reuseDecorations = false;
      if(newState.doc.textContent == "") {
        return {
        decorations: DecorationSet.empty,
        heightUpdates: [] as { pos: number; height: number }[],
        pages:[] as { pageIndex: number; start: number; end: number }[],
      };
      }

        // Start timing pagination
        const startTime = performance.now();
        
        //console.log(prev);
        //console.log(oldState);
      
        const editorEl = document.querySelector(editorSelector) as HTMLElement | null;
        const editorWidth = editorEl ? editorEl.clientWidth : DEFAULT_PAGE_WIDTH;
      
        const decorations: Decoration[] = [];
        const heightUpdates: { pos: number; height: number }[] = [];
      
        // 1. Detect which paragraphs changed in this transaction
        const changedPositions: number[] = [];
        if (tr.docChanged) {
          tr.steps.forEach(step => {
            const map = step.getMap();
            map.forEach((newStart, newEnd) => {
            const size = newState.doc.content.size;

            let start = Math.max(0, Math.min(newStart, size));
            let end = Math.max(0, Math.min(newEnd, size));

            if (start > end) [start, end] = [end, start];

            if (start === end) return;

            newState.doc.nodesBetween(start, end, (node, pos) => {
              changedPositions.push(pos);
            });
          });

          });
        }
      
        // Cursor position for determining which paragraph is active
        const selectionFrom = newState.selection.from;
        const selectionTo = newState.selection.to;
      
        // --- Optimized Paragraph Height Caching & Pagination ---
        // Use a Map to cache paragraph heights by position
        let paragraphHeightMap: Map<number, number> = new Map();
        if (Array.isArray(heightCache)) {
          for (const { pos, height } of heightCache) {
            paragraphHeightMap.set(pos, height);
          }
        }

        // Collect all paragraph positions in order
        const paragraphPositions: { pos: number; node: ProseMirrorNode }[] = [];
        newState.doc.descendants((node, pos) => {
          if (node.type.name === "paragraph") {
            paragraphPositions.push({ pos, node });
          }
        });

        // For each paragraph, only re-measure if changed, under cursor, or forced
        let pageNum = 1;
        let pageTop = 0;
        let lastBottom = 0;
        const pageBreakPositions: number[] = [];

        for (const { pos, node } of paragraphPositions) {
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
            paragraphHeightMap.set(pos, height);
            if (height !== node.attrs.height) {
              heightUpdates.push({ pos, height });
            }
          } else {
            // Use cached height if available, else fallback to node.attrs.height
            height = paragraphHeightMap.get(pos) ?? node.attrs.height;
          }

          // --- PAGINATION LOGIC ---
          const top = lastBottom;
          const bottom = top + height;
          const bottomRel = bottom - pageTop;

if (bottomRel > PAGE_HEIGHT) {
  const freeSpace = PAGE_HEIGHT - (lastBottom - pageTop);
  const pageIndex = pageNum + 1;

  //if (node && node.type.name === "paragraph") {
    if (
      node.attrs.paragraphType === "Dialogue" &&
      freeSpace > 48 &&
      node.attrs.height > freeSpace &&
      node.attrs.height > 48
    ) {
      const dom = serializer.serializeNode(node);
      const split = tryToSplitParagraph(dom, freeSpace, editorWidth);
// Detect active typing inside this same paragraph
const cursorInside =
  newState.selection.from >= pos &&
  newState.selection.from <= pos + node.nodeSize;

// If user is typing AND split is not ready
if (cursorInside && (!split || split.forceFit)) {
  // Allow temporary overflow, do NOT jump paragraph to next page.
  // Also mark that we should reuse previous decorations to avoid
  // replacing widgets while typing (prevents visual jumping).
  lastBottom = bottom;
  reuseDecorations = true;
  continue;
}
     if (split && !split.forceFit) {
  const topHeight = split.topdata.height;
  const bottomHeight = split.bottomdata.height;

  // Keep stored node height as the TOTAL (top + bottom) so subsequent
  // pagination passes use the full height.
  heightUpdates.push({ pos: pos, height: topHeight + bottomHeight });

  // widget position inside the paragraph: pos + 1 enters paragraph content
  const widgetPos = pos + 1 + split.splitPos;

  pageBreakPositions.push(widgetPos);
const lastChar = node.attrs.charref || node.attrs.characterName || "CHARACTER";
decorations.push(
  Decoration.widget(
    widgetPos , 
    () => pageBreakWidget(pageIndex, 0 , split, lastChar),
    { key: `contd-${pageIndex}` }
  )
);

  // --- IMPORTANT: update layout state to account for the top fragment ---
  // The top fragment occupies `topHeight` pixels on the current page.
  // lastBottom tracks the cumulative bottom position so far; update it.
  // `top` was computed earlier as `top = lastBottom`.
  lastBottom = top + topHeight;

  // Advance the page number and set pageTop to the new page start.
  pageNum++;
  pageTop = lastBottom;

  // Stop fallback from executing: continue to next paragraph
  continue;
}
    }

    // Fallback (node not splittable or no split possible)
    pageBreakPositions.push(pos);

    decorations.push(
      Decoration.widget(
        pos,
        () => pageBreakWidget(pageIndex, freeSpace),
        { key: `pagebreak-${pageIndex}`, side: 1 }
      )
    );
            pageNum++;
            pageTop = lastBottom;
          }
          lastBottom = bottom;
        }
      
        // 3. Build decoration set. If we're reusing previous decorations
        // (typing inside a paragraph) then keep `prev.decorations` to
        // avoid visual jumps. Otherwise create a fresh set.
        const decoSet = reuseDecorations && prev && (prev as any).decorations
          ? (prev as any).decorations
          : DecorationSet.create(newState.doc, decorations);

        const pages: { pageIndex: number; start: number; end: number }[] = [];
        let curStart = 0;
        let pageIndex = 1;
        if (reuseDecorations && prev && (prev as any).pages) {
          // Keep previous page ranges while typing to keep the layout stable.
          // We still return heightUpdates so sizes will update once typing stops.
          const prevPages = (prev as any).pages as typeof pages;
          for (const p of prevPages) pages.push(p);
        } else {
          for (const br of pageBreakPositions) { // pageBreakPositions is list of pos where break inserted
            pages.push({ pageIndex, start: curStart, end: br });
            curStart = br;
            pageIndex++;
          }
        }
        // last page
        pages.push({ pageIndex, start: curStart, end: newState.doc.content.size });
        
        // End timing and calculate duration
        const endTime = performance.now();
        const durationSeconds = (endTime - startTime) / 1000;
        console.log(`Pagination completed in ${durationSeconds.toFixed(4)} seconds`);
        decorationCache = decoSet;
        heightCache = heightUpdates;
        pageCache = pages;
        // Return updated plugin state
        return {
          decorations: decoSet,
          heightUpdates,
          pages
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

function completeUnclosedHtmlTags(htmlString: string): string {
  const stack: string[] = [];
  const result: string[] = [];
  const tagRegex = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
  const selfClosingTags = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'
  ]);

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(htmlString)) !== null) {
    const fullTag = match[0];
    const isClosing = !!match[1];
    const tagName = match[2];

    result.push(htmlString.substring(lastIndex, match.index));

    if (isClosing) {
      if (stack.length > 0 && stack[stack.length - 1] === tagName) {
        stack.pop();
      }
    } else {
      if (!selfClosingTags.has(tagName.toLowerCase())) {
        stack.push(tagName);
      }
    }

    result.push(fullTag);
    lastIndex = tagRegex.lastIndex;
  }

  result.push(htmlString.substring(lastIndex));

  while (stack.length > 0) {
    result.push(`</${stack.pop()}>`);
  }

  return result.join('');
}

function getMeasureDiv(width: number): HTMLDivElement {
  let div = document.getElementById('pm-measure-ts') as HTMLDivElement | null;
  if (!div) {
    div = document.createElement('div');
    div.id = 'pm-measure-ts';
    div.style.position = 'absolute';
    div.style.visibility = 'hidden';
    div.style.pointerEvents = 'none';
    div.style.left = '-9999px';
    div.style.top = '0';
    div.style.whiteSpace = 'break-spaces';
    document.body.appendChild(div);
  }
  div.style.width = width + 'px';
  return div;
}




// function check(): HTMLDivElement {
//   let testdiv = document.getElementById("hiddenEdDiv") as HTMLDivElement | null;
 
//   if (!testdiv) {
//     testdiv = document.createElement('div');
//     testdiv.id = 'hiddenEdDiv';
//     testdiv.className = 'hiddenEdDiv';
//     testdiv.style.width = "100%";
//     testdiv.style.position = "absolute";
//     testdiv.style.top = "-300px";
//     testdiv.style.whiteSpace = "break-spaces";
    
//     const viewer = document.getElementById('viewer');
//     if (!viewer) {
//       throw new Error('Viewer element not found');
//     }
//     viewer.append(testdiv);
//   }
  
//   return testdiv;
// }

//   // Remove the html tags to get just the text inside the html
//   function stripHtmlTags(htmlString : string): string {
//     return htmlString.replace(/<[^>]*>/g, '');
//   }
//   function completeUnclosedHtmlTags(htmlString : string): string {
//       const stack = [];
//       const result = [];
//       const tagRegex = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
//       const selfClosingTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

//       let lastIndex = 0;
//       let match;

//       while ((match = tagRegex.exec(htmlString)) !== null) {
//           const [fullTag, isClosing, tagName] = match;

//           // Add content before the current tag
//           result.push(htmlString.substring(lastIndex, match.index));

//           if (isClosing) { // Closing tag
//               if (stack.length > 0 && stack[stack.length - 1] === tagName) {
//                   stack.pop();
//               }
//           } else { // Opening tag
//               if (!selfClosingTags.has(tagName.toLowerCase())) {
//                   stack.push(tagName);
//               }
//           }
//           result.push(fullTag);
//           lastIndex = tagRegex.lastIndex;
//       }

//       // Add remaining content after the last tag
//       result.push(htmlString.substring(lastIndex));

//       // Close any remaining open tags
//       while (stack.length > 0) {
//           result.push(`</${stack.pop()}>`);
//       }

//       return result.join('');
//   }

interface SplitResult {
  splitPos: number;
  topdata: { height: number };
  bottomdata: { height: number };
  forceFit: boolean;
}


export function tryToSplitParagraph(
  dom: Node,
  freeSpace: number,
  editorWidth: number
): SplitResult | null {
  const element = dom as HTMLElement;
  let innerhtml = element.innerHTML || '';
  let outerhtml = element.outerHTML || '';

  // If last character is a space, replace with &nbsp; for accurate measurement
  const textContent = element.textContent ?? '';
  if (textContent.length && textContent[textContent.length - 1] === ' ') {
    innerhtml = innerhtml.slice(0, -1) + '&nbsp;';
  }

  // If empty paragraph, ensure a non-breaking space is present
  if (innerhtml === '' || innerhtml === '<br class="ProseMirror-trailingBreak">') {
    const regex = /(<(\\w+)[^>]*>)\s*(<\/\\2>)/g;
    outerhtml = outerhtml.replace(regex, `$1&nbsp;$3`);
  }

  // Break paragraph into sentence-like pieces
  const sentenceResult = innerhtml.match(/[^\.\!\?]+[\.\!\?\s]*/g) || [];
  if (sentenceResult.length <= 1) return null;

  const measurer = getMeasureDiv(editorWidth);

  const regex2 = /(<p\b[^>]*>)([\s\S]*?)(<\/p>)/i;
  const matches = outerhtml.match(regex2);

  // Iterate from largest top chunk (all but last) backwards
  for (let i = sentenceResult.length - 2; i >= 0; i--) {
    let partialPArray = sentenceResult.slice(0, i + 1);
    let partialPhtml = partialPArray.join('');

    partialPhtml = completeUnclosedHtmlTags(partialPhtml);
    if (partialPhtml[partialPhtml.length - 1] === ' ') {
      partialPhtml = partialPhtml.slice(0, -1) + '&nbsp;';
    }

    if (!matches) continue;
    const htmlToTest = matches[1] + partialPhtml + matches[3];

    measurer.innerHTML = htmlToTest;
    const height = measurer.getBoundingClientRect().height;

    // Get computed top margin (used to adjust bottom fragment measurement)
    const thep = measurer.querySelector('p') as HTMLElement | null;
    let marginTop = 0;
    if (thep) {
      const style = window.getComputedStyle(thep);
      marginTop = parseFloat(style.marginTop || '0');
    }

    const totalHeight = height; // includes margins from getBoundingClientRect where applicable
    if (totalHeight <= freeSpace) {
      const tophtml = matches[1] + sentenceResult.slice(0, i + 1).join('') + matches[3];
      const bottomhtml = matches[1] + sentenceResult.slice(i + 1).join('') + matches[3];

      // measure bottom block
      measurer.innerHTML = bottomhtml;
      const bottomHeight = measurer.getBoundingClientRect().height - marginTop;

      // If there's only one line in bottom fragment, avoid splitting (forceFit)
      if (bottomHeight < 20) {
        // compute split offset based on rendered textContent (handles &nbsp; correctly)
        const tmp = document.createElement('div');
        tmp.innerHTML = tophtml;
        const offset = (tmp.textContent || '').length;
        return {
          splitPos: offset,
          topdata: { height: totalHeight },
          bottomdata: { height: bottomHeight },
          forceFit: true
        };
      }

      // compute split offset based on rendered textContent (handles &nbsp; correctly)
      const tmp = document.createElement('div');
      tmp.innerHTML = tophtml;
      const offset = (tmp.textContent || '').length;

      return {
        splitPos: offset,
        topdata: { height: totalHeight },
        bottomdata: { height: bottomHeight },
        forceFit: false
      };
    }
  }

  return null;
}


// function getPageDiv(
//   pageNum: number, 
//   freeSpace: number, 
//   splitPos: SplitResult | null, 
//   nodeInfo: any, 
//   lastCharName: string
// ): HTMLElement {
//   const div = document.createElement('div');
//   div.className = 'page-break';
//   div.style.height = `${freeSpace}px`;
//   div.style.borderBottom = '1px dashed #ccc';
//   div.style.position = 'relative';
  
//   // Add page number
//   const pageLabel = document.createElement('div');
//   pageLabel.className = 'page-number';
//   pageLabel.textContent = `Page ${pageNum}`;
//   pageLabel.style.position = 'absolute';
//   pageLabel.style.bottom = '5px';
//   pageLabel.style.right = '10px';
//   pageLabel.style.fontSize = '10px';
//   pageLabel.style.color = '#999';
//   div.appendChild(pageLabel);
  
//   // Add MORE/CONT'D for split dialogue
//   if (splitPos && nodeInfo.eType === 'Dialogue') {
//     const more = document.createElement('div');
//     more.className = 'dialogue-more';
//     more.textContent = '(MORE)';
//     more.style.textAlign = 'right';
//     more.style.marginRight = '40px';
//     more.style.fontStyle = 'italic';
//     div.appendChild(more);
    
//     // Add CONT'D marker for next page (this would be in a separate decoration)
//     const contd = document.createElement('div');
//     contd.className = 'dialogue-contd';
//     contd.textContent = `${lastCharName} (CONT'D)`;
//     contd.style.textAlign = 'center';
//     contd.style.marginTop = '10px';
//     contd.style.fontWeight = 'bold';
//     // You'll need to add this to the next page's decoration
//   }
  
//   return div;
// }
