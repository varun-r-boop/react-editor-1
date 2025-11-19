// src/extensions/ParagraphExtension.ts
import { Paragraph } from "@tiptap/extension-paragraph";
import { createPaginationPlugin } from "../plugins/paginationPlugin";

export const ParagraphExtension = Paragraph.extend({
  addAttributes() {
    return {
      paragraphType: {
        default: "Action",
      },
      scenenumber: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("snum"),
        renderHTML: (attrs: any) => (attrs.scenenumber ? { snum: attrs.scenenumber } : {}),
      },
      height: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const v = element.getAttribute("height");
          return v ? Number(v) : null;
        },
        renderHTML: (attrs: any) => (attrs.height ? { height: attrs.height } : {}),
      },
    };
  },

  addProseMirrorPlugins() {
    const schema = this.editor?.schema;
    return schema ? [createPaginationPlugin(schema, { editorSelector: ".ProseMirror" })] : [];
  },
  
});
