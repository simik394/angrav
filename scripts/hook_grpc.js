/**
 * Frida script to intercept language_server socket traffic.
 * 
 * Usage:
 *   frida -p $(pgrep -f language_server) -l hook_grpc.js
 */

const OUTPUT_DIR = '/workspace/grpc_captures';
let captureCount = 0;

// Find libc
const libc = Process.getModuleByName('libc.so.6');
console.log('[*] Found libc at: ' + libc.base);

// Hook write() from libc
const writeFn = libc.getExportByName('write');
console.log('[*] write() at: ' + writeFn);

Interceptor.attach(writeFn, {
    onEnter: function (args) {
        this.fd = args[0].toInt32();
        this.buf = args[1];
        this.len = args[2].toInt32();
    },
    onLeave: function (retval) {
        // Capture writes > 500 bytes to non-stdio fds
        if (this.fd > 2 && this.len > 500) {
            captureCount++;
            const timestamp = Date.now();
            console.log('[WRITE] fd=' + this.fd + ' len=' + this.len);

            try {
                const data = this.buf.readByteArray(this.len);
                const filename = OUTPUT_DIR + '/capture_' + timestamp + '_' + captureCount + '.bin';

                const file = new File(filename, 'wb');
                file.write(data);
                file.close();

                console.log('  -> Saved: ' + filename);
            } catch (e) {
                console.log('  -> Error: ' + e);
            }
        }
    }
});

console.log('[+] Hooked write()');
console.log('[*] Waiting for traffic... Switch sessions in Antigravity.');
