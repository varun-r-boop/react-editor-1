import React, { useState } from "react";

export function BlockMenu({ node, position }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Left Icon */}
      <div
        style={{
          position: "fixed",
          left: position.left - 32 + "px",
          top: position.top + "px",
          width: "24px",
          height: "24px",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          background: "#eee",
          borderRadius: 4,
          cursor: "pointer",
          zIndex: 10000,
        }}
        onClick={() => setOpen(!open)}
      >
        ⋮
      </div>

      {/* Popup */}
      {open && (
        <div
          style={{
            position: "fixed",
            left: position.left + "px",
            top: position.top + 28 + "px",
            padding: 8,
            background: "white",
            border: "1px solid #ddd",
            borderRadius: 6,
            zIndex: 10000,
          }}
        >
          <div><b>{node.attrs.paragraphType}</b></div>
          <button>Action 1</button>
          <button>Action 2</button>
        </div>
      )}
    </>
  );
}
