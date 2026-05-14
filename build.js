const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const output = fs.createWriteStream(path.join(__dirname, 'checkin-h5-deploy.zip'));
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
    const kb = (archive.pointer() / 1024).toFixed(1);
    console.log(`\n✅ 打包完成：checkin-h5-deploy.zip (${kb} KB)`);
});

archive.pipe(output);
// 将 h5/ 目录内的文件作为 zip 根目录
archive.directory(path.join(__dirname, 'h5'), false);
archive.finalize();
