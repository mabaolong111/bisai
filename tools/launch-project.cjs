'use strict';

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

const project = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const requestedPort = Number(process.env.NUANLIN_PORT || 8765);
const buildMatch = fs.readFileSync(path.join(project, 'server.js'), 'utf8').match(/const build = ['"]([^'"]+)['"]/);
const expectedBuild = buildMatch && buildMatch[1];
let child;
let stopping = false;

function openPage(url) {
  console.log('Open in your browser: ' + url);
  if (process.env.NUANLIN_NO_BROWSER === '1') return;
  const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
    detached: true, windowsHide: true, stdio: 'ignore'
  });
  browser.on('error', error => console.error('Could not open browser: ' + error.message));
  browser.unref();
}

async function isThisProject(port) {
  try {
    // A same-files project with an older backend must not be reused: compare build first.
    const health = await fetch('http://127.0.0.1:' + port + '/api/health', { signal: AbortSignal.timeout(800) });
    if (!health.ok) return false;
    const info = await health.json();
    if (!expectedBuild || info.build !== expectedBuild) return false;
    for (const file of ['yanglao.html', 'app.js']) {
      const response = await fetch('http://127.0.0.1:' + port + '/' + file, { signal: AbortSignal.timeout(800) });
      if (!response.ok || !Buffer.from(await response.arrayBuffer()).equals(fs.readFileSync(path.join(project, file)))) return false;
    }
    return true;
  } catch { return false; }
}

function portIsFree(port) {
  return new Promise(resolve => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

async function main() {
  if (!fs.existsSync(path.join(project, 'server.js'))) throw new Error('Missing server.js: ' + project);
  if (!Number.isInteger(requestedPort) || requestedPort < 1 || requestedPort > 65535) throw new Error('NUANLIN_PORT must be an integer from 1 to 65535.');
  console.log('Project directory: ' + project);
  let port;
  let freePort;
  for (let candidate = requestedPort; candidate <= Math.min(requestedPort + 20, 65535); candidate++) {
    if (await portIsFree(candidate)) { freePort ??= candidate; continue; }
    if (await isThisProject(candidate)) {
      console.log('This project is already running; opening its existing page.');
      openPage('http://127.0.0.1:' + candidate + '/yanglao.html');
      return;
    }
  }
  port = freePort;
  if (!port) throw new Error('No free local port was found. Close an unused server or set NUANLIN_PORT.');
  if (port !== requestedPort) console.log('Port ' + requestedPort + ' is occupied; using ' + port + '.');
  child = spawn(process.execPath, [path.join(project, 'server.js')], {
    cwd: project, env: { ...process.env, NUANLIN_PORT: String(port) }, stdio: 'inherit', windowsHide: true
  });
  let exited = false;
  let spawnError;
  child.once('error', error => { spawnError = error; });
  child.once('exit', (code, signal) => {
    exited = true;
    if (!stopping && (code || signal)) console.error('Server stopped: ' + (signal || code));
    process.exitCode = code || 0;
  });
  for (let attempt = 0; attempt < 80; attempt++) {
    if (spawnError) throw spawnError;
    if (exited) throw new Error('Server exited before it was ready. Read the error above.');
    if (await isThisProject(port)) {
      console.log('Server ready. Keep this window open. Stop with Ctrl+C.');
      openPage('http://127.0.0.1:' + port + '/yanglao.html');
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('Server did not become ready. Read the error above.');
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  stopping = true;
  if (child && child.exitCode === null) child.kill();
});
main().catch(error => {
  console.error(error.message);
  if (child && child.exitCode === null) child.kill();
  process.exitCode = 1;
});
