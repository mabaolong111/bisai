// 仅用于外观验收：用隔离测试数据启动同一个 server.js，不接触正式 nuanlin-data.json。
// server.js 里有 require.main === module 守卫，所以这里用子进程拉起，而不是 require。
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const dataFile = path.join(__dirname, '.preview-data-2.json');
if (!fs.existsSync(dataFile)) {
  fs.copyFileSync(path.join(__dirname, 'acceptance-isolated-data.json'), dataFile);
}

const portKeys = Object.keys(process.env).filter(key => /port/i.test(key));
console.log('端口相关环境变量:', portKeys.map(key => `${key}=${process.env[key]}`).join(', ') || '(无)');

const port = process.env.PORT || process.env.NUANLIN_PORT || '8802';
console.log('本次监听端口:', port);

const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: {
    ...process.env,
    NUANLIN_PORT: port,
    NUANLIN_DATA: dataFile
  },
  stdio: 'inherit'
});

child.on('exit', code => process.exit(code ?? 0));
['SIGINT', 'SIGTERM'].forEach(signal => process.on(signal, () => child.kill(signal)));
