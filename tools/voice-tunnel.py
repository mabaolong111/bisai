import os
import socket
import threading
import time

import paramiko

HOST = '1.92.114.70'
USER = 'root'
KEY = os.path.expanduser('~/.ssh/nuanlin_tunnel')
LOCAL = ('127.0.0.1', 3900)
REMOTE_BIND = '127.0.0.1'
REMOTE_PORT = 3900


def pump(src, dst):
    try:
        while True:
            data = src.recv(16384)
            if not data:
                break
            dst.sendall(data)
    except Exception:
        pass
    try:
        dst.shutdown(socket.SHUT_WR)
    except Exception:
        pass


def handle(channel):
    try:
        sock = socket.create_connection(LOCAL, timeout=10)
    except Exception as error:
        print('LOCAL_VOICE_UNREACHABLE', error, flush=True)
        channel.close()
        return
    threading.Thread(target=pump, args=(channel, sock), daemon=True).start()
    pump(sock, channel)
    try:
        channel.close()
    except Exception:
        pass
    try:
        sock.close()
    except Exception:
        pass


def run_once():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, key_filename=KEY, timeout=20, banner_timeout=30, auth_timeout=30)
    transport = client.get_transport()
    transport.set_keepalive(30)
    transport.request_port_forward(REMOTE_BIND, REMOTE_PORT)
    print('TUNNEL_READY %s:%s -> %s:%s' % (REMOTE_BIND, REMOTE_PORT, LOCAL[0], LOCAL[1]), flush=True)
    while True:
        channel = transport.accept(timeout=30)
        if channel is not None:
            threading.Thread(target=handle, args=(channel,), daemon=True).start()
        elif not transport.is_active():
            raise RuntimeError('ssh transport closed')


def main():
    while True:
        try:
            run_once()
        except Exception as error:
            print('TUNNEL_RETRY', error, flush=True)
            time.sleep(5)


if __name__ == '__main__':
    main()
