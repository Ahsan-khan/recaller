'use strict';
// Stroke icons (24px grid). Rendered with the `.icon` class, which sets stroke styling.
window.ICONS = (() => {
  const svg = (body) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
  return {
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    mic: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>'),
    stop: svg('<rect x="7" y="7" width="10" height="10" rx="2.5" class="fill"/>'),
    copy: svg('<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>'),
    check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
    edit: svg('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>'),
    trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7"/>'),
    more: svg('<circle cx="5.5" cy="12" r="1.3" class="fill"/><circle cx="12" cy="12" r="1.3" class="fill"/><circle cx="18.5" cy="12" r="1.3" class="fill"/>'),
    chevron: svg('<path d="m6 9 6 6 6-6"/>'),
    used: svg('<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12.2 2.4 2.4 4.8-4.8"/>'),
    restore: svg('<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.7"/><path d="M4 4v4.7h4.7"/>'),
    grip: svg('<circle cx="9" cy="6" r="1.2" class="fill"/><circle cx="15" cy="6" r="1.2" class="fill"/><circle cx="9" cy="12" r="1.2" class="fill"/><circle cx="15" cy="12" r="1.2" class="fill"/><circle cx="9" cy="18" r="1.2" class="fill"/><circle cx="15" cy="18" r="1.2" class="fill"/>'),
    pencilLine: svg('<path d="M12 20h8"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
    arrowLeft: svg('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
    arrowRight: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
    camera: svg('<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.3l1.4-2h5.6l1.4 2h1.3A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5Z"/><circle cx="12" cy="12.5" r="3.5"/>'),
    close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
    expand: svg('<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>'),
    image: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.7"/><path d="m20.5 16-5-5-8 8.5"/>'),
    layers: svg('<path d="M12 3.5 3.5 8l8.5 4.5L20.5 8 12 3.5Z"/><path d="m3.5 12 8.5 4.5 8.5-4.5"/><path d="m3.5 16 8.5 4.5 8.5-4.5"/>'),
    highlighter: svg('<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>'),
    arrowDown: svg('<path d="M12 5v14M6 13l6 6 6-6"/>'),
    arrowUp: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
    width: svg('<path d="M4 5v14M20 5v14M8 12h8"/><path d="m11 9-3 3 3 3M13 9l3 3-3 3"/>'),
    flame: svg('<path d="M12 3c.6 3.3 5.5 5.6 5.5 10.2A5.5 5.5 0 0 1 6.5 13.4c0-2.3 1.1-3.8 2.4-5 .2 1.5.9 2.5 1.9 3C10.6 8.6 11 5.6 12 3Z"/>'),
    sort: svg('<path d="M4 7h9M4 12h7M4 17h5"/><path d="M17 5v14M14 16l3 3 3-3"/>'),
    undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
    // 1.17 sync indicator: one cloud outline (three arcs over a flat base), crossed out or with a "!"
    cloud: svg('<path d="M7.5 18.5H17a4 4 0 0 0 1-7.87 5.5 5.5 0 0 0-10.91-1.11A4.5 4.5 0 0 0 7.5 18.5Z"/>'),
    cloudOff: svg('<path d="m3.5 3.5 17 17"/><path d="M7.74 7.74a5.5 5.5 0 0 0-.65 1.78 4.5 4.5 0 0 0 .41 8.98H17a4 4 0 0 0 1.29-.21"/><path d="M10.27 5.47A5.5 5.5 0 0 1 18 10.63a4 4 0 0 1 2.73 5.3"/>'),
    cloudAlert: svg('<path d="M7.5 18.5H17a4 4 0 0 0 1-7.87 5.5 5.5 0 0 0-10.91-1.11A4.5 4.5 0 0 0 7.5 18.5Z"/><path d="M12 9.6v3.2"/><path d="M12 15.5v.1"/>'),
    // 1.18: Eating (a fork and knife), Claude Code format (a prompt), Clear (an eraser),
    // minimize a column (two arrows in), and column groups (two columns under one band)
    utensils: svg('<path d="M5 3v6a2.5 2.5 0 0 0 5 0V3M7.5 3v18"/><path d="M19 15V3a4.5 4.5 0 0 0-4.5 4.5V13a2 2 0 0 0 2 2H19Zm0 0v6"/>'),
    terminal: svg('<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="m7 9.5 3 2.5-3 2.5M12.5 15H17"/>'),
    eraser: svg('<path d="m7 20-3.3-3.3a2 2 0 0 1 0-2.8L13.9 3.7a2 2 0 0 1 2.8 0l3.6 3.6a2 2 0 0 1 0 2.8L10.5 20"/><path d="M7 20h13M8.5 9.5l6 6"/>'),
    // 1.20.7: a column's own notepad (a page with lines), and the notepad's bullet-list button
    pad: svg('<rect x="5" y="3.5" width="14" height="17" rx="2.5"/><path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4"/>'),
    list: svg('<path d="M9.5 6.5H20M9.5 12H20M9.5 17.5H20"/><circle cx="5" cy="6.5" r="1.1" class="fill"/><circle cx="5" cy="12" r="1.1" class="fill"/><circle cx="5" cy="17.5" r="1.1" class="fill"/>'),
    minimize: svg('<path d="M10 4v6H4M14 20v-6h6M10 10 3.5 3.5M14 14l6.5 6.5"/>'),
    group: svg('<rect x="3" y="3.5" width="18" height="4" rx="1.5"/><rect x="4" y="10" width="7" height="10.5" rx="1.5"/><rect x="13" y="10" width="7" height="10.5" rx="1.5"/>'),
  };
})();
