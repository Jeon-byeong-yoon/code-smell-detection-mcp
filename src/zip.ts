import { randomBytes } from 'crypto';
import { deflateRawSync } from 'zlib';

/**
 * 최소 ZIP writer.
 *
 * analyzer service(`POST /analyze`)가 multipart로 zip을 받으므로 zip을 만들어야 하는데,
 * Node에는 표준 zip 기능이 없다. npx로 배포되는 도구라 설치 무게를 늘리지 않으려고
 * 외부 의존성 대신 필요한 만큼만 직접 쓴다 (DEFLATE + 중앙 디렉토리).
 *
 * 지원 범위: UTF-8 파일명, 파일 엔트리만(디렉토리 엔트리 없음), zip64 없음.
 * 4GB 이상이나 65535개 초과 엔트리는 다루지 않는다 — 업로드 상한이 훨씬 아래에 있다.
 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

export type ZipEntry = {
  /** zip 내부 경로. 항상 '/' 구분자를 쓴다. */
  path: string;
  content: Buffer;
};

/** 엔트리들을 하나의 zip 버퍼로 만든다. */
export function createZip(entries: ZipEntry[]): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.path, 'utf8');
    const crc = crc32(entry.content);
    const compressed = deflateRawSync(entry.content);

    // 압축이 더 커지는 작은 파일은 STORE로 담는다
    const useDeflate = compressed.length < entry.content.length;
    const payload = useDeflate ? compressed : entry.content;
    const method = useDeflate ? 8 : 0;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // local file header signature
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0x0800, 6); // flags: UTF-8 filename
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0x21, 12); // mod date (1980-01-01)
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(entry.content.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra field length

    localChunks.push(localHeader, nameBuffer, payload);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // central directory signature
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x21, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(entry.content.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra
    centralHeader.writeUInt16LE(0, 32); // comment
    centralHeader.writeUInt16LE(0, 34); // disk number
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    // external attrs: regular file 0644. `<< 16`은 32비트 부호 시프트라 음수가 되므로 >>>0로 되돌린다
    centralHeader.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralChunks.push(centralHeader, nameBuffer);
    offset += localHeader.length + nameBuffer.length + payload.length;
  }

  const central = Buffer.concat(centralChunks);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  end.writeUInt16LE(0, 4); // disk number
  end.writeUInt16LE(0, 6); // central directory start disk
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localChunks, central, end]);
}

/**
 * multipart/form-data 본문 하나를 만든다 (파일 필드 1개).
 *
 * 경계 문자열은 반드시 본문에 나타나지 않아야 한다. 내용에서 유도한 값을 쓰면 안 된다 —
 * 분석 대상 소스는 신뢰할 수 없고 CRC32는 위조가 쉬워서, 공격자가 zip 안에 경계 문자열을
 * 심어 파트를 주입할 수 있다. 암호학적 난수로 뽑고 본문에 없음을 확인한다.
 */
export function createMultipartBody(
  fieldName: string,
  fileName: string,
  content: Buffer,
): { body: Buffer; contentType: string } {
  let boundary = '';
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = `----advanced-pyexamine-${randomBytes(24).toString('hex')}`;
    if (content.indexOf(candidate) === -1) {
      boundary = candidate;
      break;
    }
  }
  if (!boundary) {
    throw new Error('Failed to generate a multipart boundary absent from the payload.');
  }

  const head = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${fieldName}"; filename="${fileName}"\r\n` +
    'Content-Type: application/zip\r\n\r\n',
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');

  return {
    body: Buffer.concat([head, content, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}
