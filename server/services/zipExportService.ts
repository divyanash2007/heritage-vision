import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function computeCrc32(buffer: Buffer): number {
  return zlib.crc32(buffer) >>> 0;
}

interface ZipFileEntry {
  archivePath: string;
  absolutePath: string;
}

function collectFilesRecursive(rootDir: string, baseDir = rootDir): ZipFileEntry[] {
  if (!fs.existsSync(rootDir)) return [];
  const entries: ZipFileEntry[] = [];
  for (const item of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const full = path.join(rootDir, item.name);
    if (item.isDirectory()) {
      entries.push(...collectFilesRecursive(full, baseDir));
    } else if (item.isFile()) {
      const rel = path.relative(baseDir, full).split(path.sep).join('/');
      entries.push({ archivePath: rel, absolutePath: full });
    }
  }
  return entries;
}

/**
 * Builds a standard RFC-1951 PKZIP archive from any local directory (zero extra dependencies)
 * storing binary JPEG/PNG/WebP assets with fast Store (0) method and JSON/CSV/Markdown with Deflate (8).
 */
export function buildDirectoryZipBuffer(rootDir: string, archivePrefix = 'dataset'): Buffer {
  const files = collectFilesRecursive(rootDir);
  const localChunks: Buffer[] = [];
  const centralDirectoryChunks: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const raw = fs.readFileSync(file.absolutePath);
    const crc = computeCrc32(raw);
    const isAlreadyCompressed = /\.(jpe?g|png|webp|zip|gz)$/i.test(file.archivePath);
    const method = isAlreadyCompressed ? 0 : 8;
    const compressed = isAlreadyCompressed ? raw : zlib.deflateRawSync(raw, { level: 6 });
    const nameBuf = Buffer.from(`${archivePrefix}/${file.archivePath}`, 'utf-8');

    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0x5421, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuf.copy(localHeader, 30);

    localChunks.push(localHeader, compressed);

    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x5421, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    nameBuf.copy(centralHeader, 46);

    centralDirectoryChunks.push(centralHeader);
    offset += localHeader.length + compressed.length;
  }

  const centralDirBuf = Buffer.concat(centralDirectoryChunks);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(files.length, 8);
  endRecord.writeUInt16LE(files.length, 10);
  endRecord.writeUInt32LE(centralDirBuf.length, 12);
  endRecord.writeUInt32LE(offset, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, centralDirBuf, endRecord]);
}
