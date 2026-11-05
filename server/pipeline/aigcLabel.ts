import zlib from 'node:zlib';

/**
 * AI 生成内容的隐式标识（《人工智能生成合成内容标识办法》、GB 45438—2025）：
 * 在文件元数据里写入 AIGC 字段（是否 AI 生成、生成方、内容编号）。不改变画面，不影响微信规范检查。
 * - GIF：注释扩展块（Comment Extension），所有解码器都会安全跳过
 * - PNG：iTXt「AIGC」（JSON）+ iTXt「XML:com.adobe.xmp」（XMP）
 * - JPEG：APP1 XMP 段
 */

export interface AigcInfo {
  /** 生成方，例如“阿里云百炼 qwen-image-2.0”“用户导入” */
  producer: string;
  /** 内容编号（候选 id、任务 id） */
  produceId: string;
  /** 传播方（导出它的软件） */
  propagator?: string;
}

const TOOL = '表情包工坊';

export function aigcObject(i: AigcInfo) {
  return {
    AIGC: {
      Label: '1', // 1 = 属于人工智能生成合成内容
      ContentProducer: i.producer,
      ProduceID: i.produceId,
      ReservedCode1: '',
      ContentPropagator: i.propagator ?? TOOL,
      PropagateID: '',
      ReservedCode2: '',
    },
  };
}

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function xmpPacket(i: AigcInfo) {
  const json = JSON.stringify(aigcObject(i).AIGC);
  return (
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    `<rdf:Description rdf:about="" xmlns:TC260="http://www.tc260.org.cn/ns/AIGC/1.0/" TC260:AIGC="${xmlEscape(json)}"/>` +
    '</rdf:RDF></x:xmpmeta><?xpacket end="w"?>'
  );
}

// ---------------- GIF ----------------

/** 在全局调色板之后插入一个注释扩展块。已有 AIGC 注释的不重复插入 */
export function labelGif(gif: Buffer, i: AigcInfo): Buffer {
  if (gif.subarray(0, 3).toString('latin1') !== 'GIF') throw new Error('不是 GIF 文件');
  if (readAigc(gif)) return gif;
  const flags = gif[10];
  const gct = flags & 0x80 ? 3 * 2 ** ((flags & 0x07) + 1) : 0;
  const at = 13 + gct;
  const text = Buffer.from(JSON.stringify(aigcObject(i)), 'utf8');
  const blocks: Buffer[] = [Buffer.from([0x21, 0xfe])];
  for (let o = 0; o < text.length; o += 255) {
    const part = text.subarray(o, o + 255);
    blocks.push(Buffer.from([part.length]), part);
  }
  blocks.push(Buffer.from([0x00]));
  // GIF87a 不认扩展块，统一写成 GIF89a
  const head = Buffer.from(gif.subarray(0, at));
  head.write('GIF89a', 0, 'latin1');
  return Buffer.concat([head, ...blocks, gif.subarray(at)]);
}

function readGifComments(gif: Buffer): string[] {
  const out: string[] = [];
  const flags = gif[10];
  let p = 13 + (flags & 0x80 ? 3 * 2 ** ((flags & 0x07) + 1) : 0);
  const skipSub = () => {
    while (p < gif.length) {
      const n = gif[p++];
      if (!n) return;
      p += n;
    }
  };
  while (p < gif.length) {
    const b = gif[p++];
    if (b === 0x3b) break; // trailer
    if (b === 0x21) {
      const label = gif[p++];
      if (label === 0xfe) {
        const parts: Buffer[] = [];
        while (p < gif.length) {
          const n = gif[p++];
          if (!n) break;
          parts.push(gif.subarray(p, p + n));
          p += n;
        }
        out.push(Buffer.concat(parts).toString('utf8'));
      } else skipSub();
    } else if (b === 0x2c) {
      const f = gif[p + 8];
      p += 9;
      if (f & 0x80) p += 3 * 2 ** ((f & 0x07) + 1);
      p++; // LZW 最小码长
      skipSub();
    } else break;
  }
  return out;
}

// ---------------- PNG ----------------

function pngChunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

function iTXt(keyword: string, text: string) {
  // keyword \0 压缩标志(0) 压缩方法(0) 语言标签 \0 翻译关键词 \0 文本(UTF-8)
  return pngChunk('iTXt', Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0, 0, 0, 0, 0]), Buffer.from(text, 'utf8')]));
}

function pngChunks(png: Buffer) {
  const list: { type: string; start: number; end: number; data: Buffer }[] = [];
  let p = 8;
  while (p + 8 <= png.length) {
    const len = png.readUInt32BE(p);
    const type = png.subarray(p + 4, p + 8).toString('latin1');
    list.push({ type, start: p, end: p + 12 + len, data: png.subarray(p + 8, p + 8 + len) });
    p += 12 + len;
    if (type === 'IEND') break;
  }
  return list;
}

export function labelPng(png: Buffer, i: AigcInfo): Buffer {
  if (png.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG 文件');
  if (readAigc(png)) return png;
  const ihdr = pngChunks(png)[0];
  const extra = Buffer.concat([iTXt('AIGC', JSON.stringify(aigcObject(i))), iTXt('XML:com.adobe.xmp', xmpPacket(i))]);
  return Buffer.concat([png.subarray(0, ihdr.end), extra, png.subarray(ihdr.end)]);
}

// ---------------- JPEG ----------------

export function labelJpeg(jpg: Buffer, i: AigcInfo): Buffer {
  if (jpg[0] !== 0xff || jpg[1] !== 0xd8) throw new Error('不是 JPEG 文件');
  if (readAigc(jpg)) return jpg;
  const payload = Buffer.concat([Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1'), Buffer.from(xmpPacket(i), 'utf8')]);
  const seg = Buffer.alloc(4);
  seg.writeUInt16BE(0xffe1, 0);
  seg.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([jpg.subarray(0, 2), seg, payload, jpg.subarray(2)]);
}

// ---------------- 通用 ----------------

/** 按文件头选格式写入；不认识的格式原样返回 */
export function labelImage(buf: Buffer, i: AigcInfo): Buffer {
  const sig = buf.subarray(0, 4);
  if (sig.toString('latin1', 0, 3) === 'GIF') return labelGif(buf, i);
  if (sig.readUInt32BE(0) === 0x89504e47) return labelPng(buf, i);
  if (sig[0] === 0xff && sig[1] === 0xd8) return labelJpeg(buf, i);
  return buf;
}

/** 读出文件里的 AIGC 标识（验证用） */
export function readAigc(buf: Buffer): Record<string, string> | null {
  try {
    if (buf.subarray(0, 3).toString('latin1') === 'GIF') {
      for (const c of readGifComments(buf)) {
        const j = JSON.parse(c);
        if (j?.AIGC) return j.AIGC;
      }
      return null;
    }
    if (buf.readUInt32BE(0) === 0x89504e47) {
      for (const c of pngChunks(buf)) {
        if (c.type !== 'iTXt') continue;
        const kwEnd = c.data.indexOf(0);
        if (c.data.subarray(0, kwEnd).toString('latin1') !== 'AIGC') continue;
        // 跳过 压缩标志、压缩方法、语言标签\0、翻译关键词\0
        let p = kwEnd + 3;
        p = c.data.indexOf(0, p) + 1;
        p = c.data.indexOf(0, p) + 1;
        return JSON.parse(c.data.subarray(p).toString('utf8')).AIGC ?? null;
      }
      return null;
    }
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      const m = buf.toString('utf8').match(/TC260:AIGC="([^"]*)"/);
      if (!m) return null;
      return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
    }
  } catch {
    return null;
  }
  return null;
}
