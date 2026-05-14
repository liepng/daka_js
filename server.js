const https = require('https');
const fs = require('fs');
const path = require('path');
const forge = require('node-forge');

// 生成自签名证书
function generateCert() {
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    
    cert.publicKey = keys.publicKey;
    cert.serialNumber = String(Date.now());
    cert.validity.notBefore = new Date();
    cert.validity.notBefore.setDate(cert.validity.notBefore.getDate() - 1);
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 10);
    
    const attrs = [
        { name: 'commonName', value: 'localhost' },
        { name: 'organizationName', value: 'Dev' },
        { name: 'countryName', value: 'CN' }
    ];
    
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.setExtensions([
        { name: 'basicConstraints', cA: false, critical: true },
        { name: 'keyUsage', keyCertSign: false, digitalSignature: true, keyEncipherment: true },
        {
            name: 'subjectAltName',
            altNames: [
                { type: 2, value: 'localhost' },
                { type: 2, value: '*.local' },
                { type: 7, ip: '127.0.0.1' },
            ]
        }
    ]);
    
    // 自签名
    cert.sign(keys.privateKey, forge.md.sha256.create());
    
    return {
        cert: forge.pki.certificateToPem(cert),
        key: forge.pki.privateKeyToPem(keys.privateKey)
    };
}

const certDir = path.join(__dirname, '.certs');
if (!fs.existsSync(certDir)) fs.mkdirSync(certDir, { recursive: true });

const certFile = path.join(certDir, 'cert.pem');
const keyFile = path.join(certDir, 'key.pem');

if (!fs.existsSync(certFile)) {
    console.log('\n正在生成自签名 HTTPS 证书...\n');
    const { cert, key } = generateCert();
    fs.writeFileSync(certFile, cert);
    fs.writeFileSync(keyFile, key);
    console.log('证书生成成功！\n');
}

const server = https.createServer({
    key: fs.readFileSync(keyFile),
    cert: fs.readFileSync(certFile)
}, (req, res) => {
    let urlPath = req.url.split('?')[0];
    if (urlPath === '/') urlPath = '/h5/index.html';
    
    let filePath = path.join(__dirname, urlPath.replace(/^\//, ''));

    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const types = { '.html':'text/html;charset=utf-8', '.css':'text/css;charset=utf-8', '.js':'application/javascript;charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.mp4':'video/mp4', '.webm':'video/webm', '.json':'application/json', '.ico':'image/x-icon', '.webp':'image/webp' };
        res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
    } else {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>404</h1>');
    }
});

const PORT = process.env.PORT || 8443;

server.listen(PORT, '0.0.0.0', () => {
    const os = require('os');
    let ips = ['localhost'];
    Object.values(os.networkInterfaces()).forEach(iface => {
        iface.forEach(a => { if (a.family === 'IPv4' && !a.internal) ips.push(a.address); });
    });
    console.log('=========================================');
    console.log('  HTTPS 本地服务器已启动！');
    console.log('=========================================\n');
    ips.forEach(ip => console.log(`  https://${ip}:${PORT}/h5/`));
    console.log('\n手机浏览器打开上面的地址');
    console.log('(提示"不安全"时 → 点击"高级" → "继续访问")\n');
});
