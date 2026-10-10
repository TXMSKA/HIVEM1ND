const SVG = "http://www.w3.org/2000/svg";

export function renderQr(document, matrix, label) {
  if (!Array.isArray(matrix) || matrix.length !== 37 || matrix.some((row) => !Array.isArray(row) || row.length !== 37)) {
    throw new RangeError("QR payload does not fit.");
  }
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 45 45");
  svg.setAttribute("width", "225");
  svg.setAttribute("height", "225");
  svg.setAttribute("role", "img");
  svg.setAttribute("class", "qr");
  const title = document.createElementNS(SVG, "title");
  title.textContent = label;
  svg.append(title);
  const quiet = document.createElementNS(SVG, "rect");
  quiet.setAttribute("x", "0");
  quiet.setAttribute("y", "0");
  quiet.setAttribute("width", "45");
  quiet.setAttribute("height", "45");
  quiet.setAttribute("fill", "var(--qr-light)");
  svg.append(quiet);
  const commands = [];
  for (let y = 0; y < 37; y += 1) {
    for (let x = 0; x < 37; x += 1) {
      if (matrix[y][x]) commands.push(`M${x + 4} ${y + 4}h1v1h-1z`);
    }
  }
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", commands.join(""));
  path.setAttribute("fill", "var(--qr-dark)");
  svg.append(path);
  return svg;
}
