export function encodeWav(
  channels: Float32Array[],
  sampleRate: number,
): Uint8Array {
  if (
    channels.length < 1 ||
    channels.length > 2 ||
    !channels[0]?.length ||
    channels.some((c) => c.length !== channels[0]!.length)
  )
    throw new Error("Expected 1 or 2 equal non-empty channels");
  const frames = channels[0].length,
    bytes = frames * channels.length * 2;
  if (bytes > 0xffffffff - 36) throw new Error("RIFF size limit exceeded");
  const out = new Uint8Array(44 + bytes),
    v = new DataView(out.buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
  };
  text(0, "RIFF");
  v.setUint32(4, 36 + bytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels.length, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels.length * 2, true);
  v.setUint16(32, channels.length * 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, bytes, true);
  let at = 44;
  for (let i = 0; i < frames; i++)
    for (const ch of channels) {
      const n = Number.isFinite(ch[i]) ? Math.max(-1, Math.min(1, ch[i]!)) : 0;
      v.setInt16(at, Math.round(n < 0 ? n * 32768 : n * 32767), true);
      at += 2;
    }
  return out;
}

export type SampleLoop = {
  startFrame: number;
  endFrame: number;
  /** MIDI note the sample was recorded at, when the file declares one. */
  rootMidi?: number;
};

export type DecodedWav = {
  channels: Float32Array[];
  sampleRate: number;
  /** Loop points declared by a `smpl` chunk, if any. */
  loop?: SampleLoop;
};

const midiFromUnityNote = (unity: number) => (unity > 127 ? undefined : unity);

/**
 * Decode PCM16 / PCM24 / PCM32-float WAV. Real-world sample packs carry
 * LIST/bext/smpl chunks and sometimes a RIFF size that disagrees with the file
 * length, so the header is parsed leniently and the data chunk drives the frame
 * count. A `smpl` chunk is read for root note and sustain loop points.
 */
export function decodeWav(bytes: Uint8Array): DecodedWav {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    str = (o: number, n: number) =>
      String.fromCharCode(...bytes.subarray(o, o + n));
  if (bytes.length < 44 || str(0, 4) !== "RIFF" || str(8, 4) !== "WAVE")
    throw new Error("Invalid WAVE file: missing RIFF/WAVE header");
  // Some encoders write a placeholder or streaming size; warn by ignoring it
  // rather than rejecting an otherwise valid file.
  let sampleRate = 0,
    count = 0,
    bits = 0,
    format = 0,
    dataOffset = 0,
    dataSize = 0,
    align = 0,
    loop: SampleLoop | undefined;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const size = v.getUint32(at + 4, true),
      body = at + 8;
    if (body + Math.min(size, 0) > bytes.length)
      throw new Error("Truncated WAV chunk");
    const id = str(at, 4);
    if (id === "fmt ") {
      if (size < 16) throw new Error("Short fmt chunk");
      format = v.getUint16(body, true);
      count = v.getUint16(body + 2, true);
      sampleRate = v.getUint32(body + 4, true);
      align = v.getUint16(body + 12, true);
      bits = v.getUint16(body + 14, true);
      // WAVE_FORMAT_EXTENSIBLE: the real format lives in the GUID's first word.
      if (format === 0xfffe && size >= 40)
        format = v.getUint16(body + 24, true);
    } else if (id === "data") {
      dataOffset = body;
      // Clamp to the bytes actually present so a bad header size cannot read OOB.
      dataSize = Math.min(size, bytes.length - body);
    } else if (id === "smpl" && size >= 36) {
      const unity = v.getUint32(body + 12, true);
      const numLoops = v.getUint32(body + 28, true);
      if (numLoops > 0 && size >= 36 + 24) {
        const loopType = v.getUint32(body + 36 + 4, true);
        const start = v.getUint32(body + 36 + 8, true);
        const end = v.getUint32(body + 36 + 12, true);
        // Type 0 is a forward loop; the end frame in `smpl` is inclusive.
        if (loopType === 0 && end > start)
          loop = {
            startFrame: start,
            endFrame: end + 1,
            rootMidi: midiFromUnityNote(unity),
          };
      }
      if (!loop)
        loop = {
          startFrame: 0,
          endFrame: 0,
          rootMidi: midiFromUnityNote(unity),
        };
      if (loop.endFrame === 0) loop = undefined;
    }
    at = body + size + (size % 2);
  }
  const bytesPerSample = Math.ceil(bits / 8);
  const validFormat =
    (format === 1 && (bits === 16 || bits === 24 || bits === 32)) ||
    (format === 3 && bits === 32);
  if (
    !validFormat ||
    count < 1 ||
    count > 2 ||
    sampleRate === 0 ||
    align !== count * bytesPerSample ||
    !dataOffset ||
    dataSize % align !== 0
  )
    throw new Error(
      `Unsupported WAV: need mono/stereo PCM16/24/32 or float32 (got format ${format}, ${bits}-bit, ${count}ch)`,
    );
  const frames = dataSize / align,
    channels = Array.from({ length: count }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < count; c++) {
      const off = dataOffset + (i * count + c) * bytesPerSample;
      let value: number;
      if (format === 3) value = v.getFloat32(off, true);
      else if (bits === 16) {
        const n = v.getInt16(off, true);
        value = n < 0 ? n / 32768 : n / 32767;
      } else if (bits === 24) {
        const b0 = bytes[off]!,
          b1 = bytes[off + 1]!,
          b2 = bytes[off + 2]!;
        let n = b0 | (b1 << 8) | (b2 << 16);
        if (n & 0x800000) n |= -8388608;
        value = n < 0 ? n / 8388608 : n / 8388607;
      } else {
        const n = v.getInt32(off, true);
        value = n < 0 ? n / 2147483648 : n / 2147483647;
      }
      channels[c]![i] = value;
    }
  return { channels, sampleRate, loop };
}

export function encodeSmplChunk(
  sampleRate: number,
  rootMidi: number,
  startFrame: number,
  endFrameInclusive: number,
): Uint8Array {
  const size = 36 + 24;
  const out = new Uint8Array(8 + size);
  const v = new DataView(out.buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
  };
  text(0, "smpl");
  v.setUint32(4, size, true);
  v.setUint32(8, 0, true); // manufacturer
  v.setUint32(12, 0, true); // product
  v.setUint32(16, Math.round(1e9 / sampleRate), true); // sample period ns
  v.setUint32(20, rootMidi, true); // MIDI unity note
  v.setUint32(24, 0, true); // pitch fraction
  v.setUint32(28, 0, true); // SMPTE format
  v.setUint32(32, 0, true); // SMPTE offset
  v.setUint32(36, 1, true); // one loop
  v.setUint32(40, 0, true); // sampler data
  v.setUint32(44, 0, true); // cue point id
  v.setUint32(48, 0, true); // type: forward
  v.setUint32(52, startFrame, true);
  v.setUint32(56, endFrameInclusive, true);
  v.setUint32(60, 0, true); // fraction
  v.setUint32(64, 0, true); // play count: infinite
  return out;
}
