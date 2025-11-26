import { Paragraph } from "@tiptap/extension-paragraph";
import { createPaginationPlugin } from "../plugins/paginationPlugin";
import { mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { BlockMenuNodeView } from "./BlockMenuNodeView";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    ScenePopupCommand: {
      insertCharacterAndDialogue: (char : string) => ReturnType;
    };
  }
}
export const ParagraphExtension = Paragraph.extend({

  addAttributes() {
    return {
      paragraphType: {
        default: "Action", // Action | Character | Dialogue
      },

      scenenumber: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("snum"),
        renderHTML: attrs => attrs.scenenumber ? { snum: attrs.scenenumber } : {},
      },

      height: {
        default: null,
        parseHTML: el => el.getAttribute("height") ? Number(el.getAttribute("height")) : null,
        renderHTML: attrs => attrs.height ? { height: attrs.height } : {},
      },

      // NEW — Only used for Character paragraphs
      characterName: {
        default: null,
        parseHTML: el => el.getAttribute("charname"),
        renderHTML: attrs => attrs.characterName ? { charname: attrs.characterName } : {},
      },

      // NEW — For Dialogue paragraphs to point to their Character
      charref: {
        default: null,
        parseHTML: el => el.getAttribute("charref"),
        renderHTML: attrs => attrs.charref ? { charref: attrs.charref } : {},
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "p[paragraphType]",
      },
      {
        tag: "p",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["p", mergeAttributes(HTMLAttributes), 0];
  },

  // -------------------------------
  // ADD COMMANDS
  // -------------------------------
  addCommands() {
    return {
      insertCharacterAndDialogue:
        (characterName: string) =>
        ({ chain }) => {
          return (
            chain()
              .insertContent([
                {
                  type: this.name,
                  attrs: {
                    paragraphType: "Character",
                    characterName,
                  },
                },
                {
                  type: this.name,
                  attrs: {
                    paragraphType: "Dialogue",
                    charref: characterName,
                  },
                },
              ])
              .run()
          );
        },
    };
  },

  // -------------------------------
  // KEYBOARD SHORTCUT
  // Ctrl + Shift + I
  // -------------------------------
addKeyboardShortcuts() {
  return {
    // Inserts only CHARACTER when using shortcut
    "Ctrl-Shift-i": () => {
      const defaultName = "CHARACTER NAME";
      return this.editor.commands.insertContent({
        type: "paragraph",
        attrs: {
          paragraphType: "Character",
          characterName: defaultName,
        },
      });
    },

    Enter: () => {
      const { state } = this.editor;
      const { $from } = state.selection;
      const node = $from.node();

      if (!node || node.type.name !== "paragraph") return false;

      const attrs = node.attrs;

      // ---------------------------------------------------
      // 1. CHARACTER → insert Dialogue on Enter
      // ---------------------------------------------------
      if (attrs.paragraphType === "Character") {
        const charName =
          attrs.characterName || node.textContent.trim().toUpperCase();

        this.editor.commands.insertContent({
          type: "paragraph",
          attrs: { paragraphType: "Dialogue", charref: charName },
        });

        return true; // stop default enter
      }

      // ---------------------------------------------------
      // 2. DIALOGUE → If user presses Enter on an EMPTY dialogue line,
      //    exit the Dialogue block
      // ---------------------------------------------------
      if (attrs.paragraphType === "Dialogue") {
        const isEmpty = node.textContent.trim().length === 0;

        //if (isEmpty) {
          // Insert a normal Action paragraph and exit Dialogue
          this.editor.commands.insertContent({
            type: "paragraph",
            attrs: { paragraphType: "Action" },
          });

          return true;
        //}

        // otherwise: allow normal Enter to create another Dialogue line
        return false;
      }

      // Normal Enter for all other cases
      return false;
    },
  };
},


  addProseMirrorPlugins() {
    const schema = this.editor?.schema;
    return schema ? [createPaginationPlugin(schema, { editorSelector: ".ProseMirror" })] : [];
  },
 addNodeView() {
  return (props) => new BlockMenuNodeView(props);
},

});
