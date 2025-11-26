import { createRoot } from "react-dom/client";
import { BlockMenu } from "../block-menu/BlockMenu";

export const BlockMenuNodeView = (props) => {
  const { node, getPos, view } = props;

  // Create a DOM container for this block's portal
  const domElement = document.createElement("div");
  const uiRoot = document.getElementById("editor-block-ui");
  uiRoot.appendChild(domElement);

  // Create React root (React 18 syntax)
  const root = createRoot(domElement);

  const render = () => {
    const dom = view.nodeDOM(getPos()) as HTMLElement;
    if (!dom) return;

    const rect = dom.getBoundingClientRect();

    root.render(
      <BlockMenu node={node} position={{ left: rect.left, top: rect.top }} />
    );
  };

  return {
    dom: null, // keep DOM minimal (<p> only)

    selectNode() {
      render();
    },

    deselectNode() {
      root.render(null); // hide BlockMenu
    },

    update(updatedNode) {
      props.node = updatedNode;
      render();
      return true;
    },

    destroy() {
      root.unmount(); // cleanup React root
      domElement.remove(); // cleanup DOM
    },
  };
};
