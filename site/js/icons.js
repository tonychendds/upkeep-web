const PATHS = {
  summary: ["M4 19V9", "M12 19V4", "M20 19v-7"],
  house: "M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z",
  car: [
    "M3 13.5 5.2 8.8A2 2 0 0 1 7 7.8h8.3a2 2 0 0 1 1.8 1.1L19.2 13.5",
    "M2.5 13.5h19v4H2.5z",
    "M7 19.2a2.1 2.1 0 1 0 0-4.2 2.1 2.1 0 0 0 0 4.2z",
    "M17 19.2a2.1 2.1 0 1 0 0-4.2 2.1 2.1 0 0 0 0 4.2z",
  ],
  upcoming: "M7 3v3M17 3v3M4 9h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z",
  jobs: "M8 7h12M8 12h12M8 17h12M4 7h.01M4 12h.01M4 17h.01",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  plus: "M12 5v14M5 12h14",
  sync: "M21 12a9 9 0 0 1-15 6.7M3 12A9 9 0 0 1 18 5.3M3 18v-4h4M21 6v4h-4",
};

export function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("icon");
  const spec = PATHS[name] || PATHS.more;
  for (const d of Array.isArray(spec) ? spec : [spec]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.8");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
  }
  return svg;
}
