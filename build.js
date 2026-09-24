// Bundles src/app.tsx with esbuild and assembles a single self-contained
// index.html (styles + bundle inlined, React/html2canvas/jsPDF from CDN).
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const shimDir = path.join(root, '.shims');
fs.mkdirSync(shimDir, { recursive: true });

fs.writeFileSync(path.join(shimDir, 'react.js'), 'module.exports = window.React;\n');
fs.writeFileSync(path.join(shimDir, 'react-dom.js'), 'module.exports = window.ReactDOM;\n');
fs.writeFileSync(path.join(shimDir, 'react-dom-client.js'), 'module.exports = window.ReactDOM;\n');
fs.writeFileSync(
  path.join(shimDir, 'jsx-runtime.js'),
  // The automatic JSX runtime calls jsx(type, props, key): children live in
  // props.children and the third arg is the key. React.createElement treats its
  // third+ args as children, so it must be adapted here -- otherwise a keyed
  // element (every list row) renders its key string in place of its children.
  'const R = window.React;\n' +
    'function jsx(type, config, maybeKey) {\n' +
    '  if (maybeKey === undefined) return R.createElement(type, config);\n' +
    '  var props = {};\n' +
    '  for (var k in config) { if (Object.prototype.hasOwnProperty.call(config, k)) props[k] = config[k]; }\n' +
    '  props.key = maybeKey;\n' +
    '  return R.createElement(type, props);\n' +
    '}\n' +
    'module.exports = { jsx: jsx, jsxs: jsx, Fragment: R.Fragment };\n'
);

const esbuild = path.join(root, 'node_modules', '.bin', 'esbuild');
execSync(
  `"${esbuild}" src/app.tsx --bundle --format=iife --jsx=automatic ` +
    `--alias:react=./.shims/react.js ` +
    `--alias:react-dom/client=./.shims/react-dom-client.js ` +
    `--alias:react-dom=./.shims/react-dom.js ` +
    `--alias:react/jsx-runtime=./.shims/jsx-runtime.js ` +
    `--outfile=bundle.js`,
  { cwd: root, stdio: 'inherit' }
);

const css = fs.readFileSync(path.join(root, 'src', 'style.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'bundle.js'), 'utf8');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>N Square Energies - Solar Pump Quotation Generator</title>
<style>
${css}
</style>
</head>
<body>
<div id="app-root"></div>
<div id="print-root"></div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
<script>
${js}
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(root, 'index.html'), html);
console.log('Built index.html (' + html.length + ' bytes)');
