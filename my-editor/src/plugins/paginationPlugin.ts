// src/plugins/paginationPlugin.ts
import { EditorState, Plugin, PluginKey, Transaction } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { DOMSerializer, Schema, Node as ProseMirrorNode } from "prosemirror-model";
export const paginationKey = new PluginKey("paginationPlugin");

const PAGE_HEIGHT = 800;
const DEFAULT_PAGE_WIDTH = 650;
let heightCache: any;

interface ParagraphInfo {
  pos: number;
  top: number;
  bottom: number;
  pageTop: number;
  paragraphType: string;
}

interface ParagraphPosition {
  pos: number;
  node: ProseMirrorNode;
}

interface HeightUpdate {
  pos: number;
  height: number;
}

interface SelectionRange {
  from: number;
  to: number;
}

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

function collectParagraphPositions(doc: ProseMirrorNode): ParagraphPosition[] {
  const positions: ParagraphPosition[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "paragraph") {
      positions.push({ pos, node });
    }
  });
  return positions;
}

function collectChangedPositions(tr: Transaction, doc: ProseMirrorNode): number[] {
  if (!tr.docChanged) return [];

  const changed: number[] = [];
  tr.steps.forEach(step => {
    const map = step.getMap();
    map.forEach((newStart, newEnd) => {
      const size = doc.content.size;
      let start = Math.max(0, Math.min(newStart, size));
      let end = Math.max(0, Math.min(newEnd, size));
      if (start > end) [start, end] = [end, start];
      if (start === end) return;
      doc.nodesBetween(start, end, (_, pos) => {
        changed.push(pos);
      });
    });
  });
  return changed;
}

function getHeightMapFromCache(): Map<number, number> {
  const map = new Map<number, number>();
  if (Array.isArray(heightCache)) {
    for (const entry of heightCache) {
      if (typeof entry?.pos === "number" && typeof entry?.height === "number") {
        map.set(entry.pos, entry.height);
      }
    }
  }
  return map;
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

function ensureParagraphHeights(args: {
  paragraphPositions: ParagraphPosition[];
  serializer: DOMSerializer;
  editorWidth: number;
  selection: SelectionRange;
  changedPositions: Set<number>;
  force: boolean;
}): { heightMap: Map<number, number>; heightUpdates: HeightUpdate[] } {
  const { paragraphPositions, serializer, editorWidth, selection, changedPositions, force } = args;
  const heightMap = getHeightMapFromCache();
  const heightUpdates: HeightUpdate[] = [];

  for (const { pos, node } of paragraphPositions) {
    const cursorInside =
      (selection.from >= pos && selection.from <= pos + node.nodeSize) ||
      (selection.to >= pos && selection.to <= pos + node.nodeSize);

    const cachedHeight = heightMap.get(pos);
    const needsMeasurement =
      force ||
      cursorInside ||
      changedPositions.has(pos) ||
      !node.attrs.height ||
      node.attrs.height <= 0 ||
      typeof cachedHeight !== "number";

    if (needsMeasurement) {
      const height = measureNodeHeight(serializer, node, editorWidth);
      heightMap.set(pos, height);
      if (height !== node.attrs.height) {
        heightUpdates.push({ pos, height });
      }
    } else if (typeof cachedHeight === "number") {
      heightMap.set(pos, cachedHeight);
    }
  }

  return { heightMap, heightUpdates };
}

function paginateParagraphs(args: {
  paragraphPositions: ParagraphPosition[];
  heightMap: Map<number, number>;
  selection: SelectionRange;
  serializer: DOMSerializer;
  editorWidth: number;
}): {
  decorations: Decoration[];
  pageBreakPositions: number[];
  extraHeightUpdates: HeightUpdate[];
  reuseDecorations: boolean;
} {
  const { paragraphPositions, heightMap, selection, serializer, editorWidth } = args;
  const decorations: Decoration[] = [];
  const pageBreakPositions: number[] = [];
  const extraHeightUpdates: HeightUpdate[] = [];

  let reuseDecorations = false;
  let pageNum = 1;
  let pageTop = 0;
  let lastBottom = 0;
  let prevParagraphInfo: ParagraphInfo | null = null;

  for (const { pos, node } of paragraphPositions) {
    const height = heightMap.get(pos) ?? node.attrs.height ?? 0;
    const top = lastBottom;
    const bottom = top + height;
    const bottomRel = bottom - pageTop;
    const paragraphType = node.attrs.paragraphType || "Action";
    const startingPageTop = pageTop;
    let paragraphPageStart = startingPageTop;
    let effectiveBottom = bottom;

    if (bottomRel > PAGE_HEIGHT) {
      const freeSpace = PAGE_HEIGHT - (lastBottom - pageTop);
      const nextPageIndex = pageNum + 1;

      if (
        paragraphType === "Dialogue" &&
        freeSpace > 48 &&
        height > freeSpace &&
        height > 48
      ) {
        const dom = serializer.serializeNode(node);
        const split = findSplitPosition(dom, freeSpace, editorWidth);
        const cursorInside =
          (selection.from >= pos && selection.from <= pos + node.nodeSize) ||
          (selection.to >= pos && selection.to <= pos + node.nodeSize);

        if (cursorInside && (!split || split.forceFit)) {
          lastBottom = bottom;
          reuseDecorations = true;
          continue;
        }

        if (split && !split.forceFit) {
          const topHeight = split.topdata.height;
          const bottomHeight = split.bottomdata.height;
          const combinedHeight = topHeight + bottomHeight;

          extraHeightUpdates.push({ pos, height: combinedHeight });
          heightMap.set(pos, combinedHeight);

          const widgetPos = pos + 1 + split.splitPos;
          pageBreakPositions.push(widgetPos);
          const lastChar = node.attrs.charref || node.attrs.characterName || "CHARACTER";
          decorations.push(
            Decoration.widget(
              widgetPos,
              () => pageBreakWidget(nextPageIndex, 0, split, lastChar),
              { key: `contd-${nextPageIndex}` }
            )
          );

          lastBottom = top + topHeight;
          pageNum++;
          pageTop = lastBottom;
          effectiveBottom = lastBottom;
          prevParagraphInfo = {
            pos,
            top,
            bottom: effectiveBottom,
            pageTop: paragraphPageStart,
            paragraphType,
          };
          continue;
        }
      }

      let breakPos = pos;
      let widgetFreeSpace = freeSpace;
      let nextPageTop = lastBottom;

      const sceneHeaderInfo =
        prevParagraphInfo &&
        prevParagraphInfo.paragraphType === "SceneHeader" &&
        prevParagraphInfo.pageTop === pageTop &&
        Math.abs(prevParagraphInfo.bottom - top) < 0.5
          ? prevParagraphInfo
          : null;

      if (sceneHeaderInfo) {
        breakPos = sceneHeaderInfo.pos;
        const consumedBeforeHeader = sceneHeaderInfo.top - pageTop;
        widgetFreeSpace = Math.max(0, PAGE_HEIGHT - consumedBeforeHeader);
        nextPageTop = sceneHeaderInfo.top;
        prevParagraphInfo = null;
      }

      pageBreakPositions.push(breakPos);
      decorations.push(
        Decoration.widget(
          breakPos,
          () => pageBreakWidget(nextPageIndex, widgetFreeSpace),
          { key: `pagebreak-${nextPageIndex}`, side: 1 }
        )
      );

      pageNum++;
      pageTop = nextPageTop;
      paragraphPageStart = pageTop;
    }

    lastBottom = bottom;
    prevParagraphInfo = {
      pos,
      top,
      bottom: effectiveBottom,
      pageTop: paragraphPageStart,
      paragraphType,
    };
  }

  return { decorations, pageBreakPositions, extraHeightUpdates, reuseDecorations };
}

function buildPages(args: {
  docSize: number;
  pageBreakPositions: number[];
  reuseDecorations: boolean;
  previousPages?: { pageIndex: number; start: number; end: number }[];
}) {
  const { docSize, pageBreakPositions, reuseDecorations, previousPages } = args;
  if (reuseDecorations && previousPages && previousPages.length) {
    return previousPages;
  }

  const pages: { pageIndex: number; start: number; end: number }[] = [];
  let curStart = 0;
  let pageIndex = 1;

  for (const breakPos of pageBreakPositions) {
    pages.push({ pageIndex, start: curStart, end: breakPos });
    curStart = breakPos;
    pageIndex++;
  }

  pages.push({ pageIndex, start: curStart, end: docSize });
  return pages;
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
          heightUpdates: [] as HeightUpdate[],
          pages:[] as { pageIndex: number; start: number; end: number }[]
          
        };
      },

    apply(tr, prev, _oldState, newState) {
      const meta = tr.getMeta(paginationKey) || {};
      const force = !!meta.force;

      if (!tr.docChanged && !force) {
        return prev;
      }

      if (newState.doc.textContent === "") {
        return {
          decorations: DecorationSet.empty,
          heightUpdates: [] as HeightUpdate[],
          pages: [] as { pageIndex: number; start: number; end: number }[],
        };
      }

      const startTime = performance.now();
      const editorEl = document.querySelector(editorSelector) as HTMLElement | null;
      const editorWidth = editorEl ? editorEl.clientWidth : DEFAULT_PAGE_WIDTH;
      const changedPositions = collectChangedPositions(tr as Transaction, newState.doc);
      const paragraphPositions = collectParagraphPositions(newState.doc);
      const selection: SelectionRange = {
        from: newState.selection.from,
        to: newState.selection.to,
      };

      const { heightMap, heightUpdates: measuredHeightUpdates } = ensureParagraphHeights({
        paragraphPositions,
        serializer,
        editorWidth,
        selection,
        changedPositions: new Set(changedPositions),
        force,
      });

      const paginationResult = paginateParagraphs({
        paragraphPositions,
        heightMap,
        selection,
        serializer,
        editorWidth,
      });

      const heightUpdates = [
        ...measuredHeightUpdates,
        ...paginationResult.extraHeightUpdates,
      ];

      const reuseDecorations = paginationResult.reuseDecorations;
      const decorations =
        reuseDecorations && prev && (prev as any).decorations
          ? (prev as any).decorations
          : DecorationSet.create(newState.doc, paginationResult.decorations);

      const pages = buildPages({
        docSize: newState.doc.content.size,
        pageBreakPositions: paginationResult.pageBreakPositions,
        reuseDecorations,
        previousPages: reuseDecorations && prev ? (prev as any).pages : undefined,
      });

      const endTime = performance.now();
      const durationSeconds = (endTime - startTime) / 1000;
      console.log(`Pagination completed in ${durationSeconds.toFixed(4)} seconds`);

      heightCache = Array.from(heightMap.entries()).map(([pos, height]) => ({
        pos,
        height,
      }));

      return {
        decorations,
        heightUpdates,
        pages,
      };
    },

    },

    appendTransaction(_: any, _oldState: EditorState, newState: EditorState) {
        //console.log(oldState);
      const pluginState = paginationKey.getState(newState) as any;
      if (!pluginState) return null;

      const updates: HeightUpdate[] = pluginState.heightUpdates || [];
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
      decorations(state: EditorState) {
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


export function findSplitPosition(
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
