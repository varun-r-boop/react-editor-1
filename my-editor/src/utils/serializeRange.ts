import { DOMSerializer } from "prosemirror-model";
import type { Schema, Node as PMNode } from "prosemirror-model";

export function serializeRangeToHTML(
  schema: Schema,
  doc: PMNode,
  start: number,
  end: number
): string {
  const slice = doc.slice(start, end);
  const serializer = DOMSerializer.fromSchema(schema);
  const wrapper = document.createElement("div");

  slice.content.forEach((node, offset) => {
    const dom = serializer.serializeNode(node) as HTMLElement;

    // Optional: embed positions for click mapping
    dom.setAttribute("data-pos", String(start + offset));

    wrapper.appendChild(dom);
  });

  return wrapper.innerHTML;
}
