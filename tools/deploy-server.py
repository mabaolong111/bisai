import paramiko
import os
import sys
import time

HOST = '1.92.114.70'
USER = 'root'
BASE = os.path.dirname(os.path.abspath(__file__))
KEY = os.path.expanduser('~/.ssh/nuanlin_tunnel')
PUB = open(os.path.expanduser('~/.ssh/nuanlin_tunnel.pub'), encoding='utf-8').read().strip()
FILES = ['app.js', 'style.css', 'yanglao.html', 'server.js']

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, key_filename=KEY, timeout=20, banner_timeout=30, auth_timeout=30)
transport = client.get_transport()
transport.set_keepalive(20)

def run(cmd, timeout=90):
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', 'replace').strip()
    err = stderr.read().decode('utf-8', 'replace').strip()
    code = stdout.channel.recv_exit_status()
    print('$ ' + cmd)
    if out:
        print(out[:4000])
    if err:
        print('[stderr] ' + err[:1000])
    print('[exit %s]\n' % code)
    return code

run("mkdir -p /root/.ssh && chmod 700 /root/.ssh && grep -qxF '%s' /root/.ssh/authorized_keys 2>/dev/null || echo '%s' >> /root/.ssh/authorized_keys; chmod 600 /root/.ssh/authorized_keys; echo KEY_OK" % (PUB, PUB))

stamp = time.strftime('%Y%m%d-%H%M%S')
backup = '/srv/nuanlin-backup/' + stamp
run('mkdir -p %s && cp -a /srv/nuanlin/app.js /srv/nuanlin/style.css /srv/nuanlin/yanglao.html /srv/nuanlin/server.js %s/ && ls -la %s' % (backup, backup, backup))

sftp = client.open_sftp()
for name in FILES:
    local = os.path.join(BASE, '..', name)
    remote = '/srv/nuanlin/' + name
    tmp = remote + '.upload'
    sftp.put(local, tmp)
    sftp.chmod(tmp, 0o644)
    try:
        sftp.remove(remote)
    except IOError:
        pass
    sftp.rename(tmp, remote)
    print('uploaded', name, os.path.getsize(local))
sftp.close()

run("cd /srv/nuanlin && md5sum app.js style.css yanglao.html server.js")
run("pkill -f '^/opt/node/bin/node server\\.js' || true; sleep 1; sh /opt/nuanlin/run.sh >/dev/null 2>&1; sleep 4; pgrep -af 'server\\.js' || true")
run("curl -s -m 5 http://127.0.0.1:8765/api/health; echo; grep -c '便民养老服务' /srv/nuanlin/yanglao.html; grep -c 'unlockAudio' /srv/nuanlin/app.js; grep -c 'var(--font-scale' /srv/nuanlin/style.css")
client.close()
print('DEPLOY_DONE backup=' + backup)
