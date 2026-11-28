import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  generateMessageIDV2,
  generateWAMessageFromContent,
  prepareWAMessageMedia,
  WAProto,
  WAMessageKey,
  WASocket,
} from '@whiskeysockets/baileys';

let protoExtensionsInstalled = false;

/**
 * Installs non-invasive runtime wire extensions on Baileys WAProto so:
 *  - StickerMessage encodes field 25 (`emojis`) & field 26 (`audioMessage`, Sound Sticker)
 *  - Message encodes field 134 (`audioStickerMessage`, FutureProofMessage Sound Sticker wrapper)
 * Matching upstream WhatsApp WAWebProtobufsE2E.proto wire tags without mutating node_modules.
 */
export function installWhatsAppV5ProtoExtensions(): void {
  if (protoExtensionsInstalled) return;
  protoExtensionsInstalled = true;

  const StickerMsgCls = WAProto.Message.StickerMessage as any;
  const origStickerEncode = StickerMsgCls.encode.bind(StickerMsgCls);
  StickerMsgCls.encode = function encodeWithSoundSticker(m: any, w?: any) {
    const writer = origStickerEncode(m, w);
    if (m && typeof m.emojis === 'string' && m.emojis.length > 0) {
      writer.uint32((25 << 3) | 2).string(m.emojis);
    }
    if (m && m.audioMessage) {
      const fork = writer.uint32((26 << 3) | 2).fork();
      WAProto.Message.AudioMessage.encode(m.audioMessage, fork).ldelim();
    }
    return writer;
  };

  const MsgCls = WAProto.Message as any;
  const origMsgEncode = MsgCls.encode.bind(MsgCls);
  MsgCls.encode = function encodeWithAudioStickerWrapper(m: any, w?: any) {
    const writer = origMsgEncode(m, w);
    if (m && m.audioStickerMessage) {
      const fork = writer.uint32((134 << 3) | 2).fork();
      WAProto.Message.FutureProofMessage.encode(m.audioStickerMessage, fork).ldelim();
    }
    return writer;
  };
}

export interface MotionPhotoProtoMetadata {
  stillSha256Hex: string;
  videoSha256Hex: string;
  presentationOffsetMs: number;
  parentByteLength: number;
  childByteLength: number;
  associationType: number;
}

export function buildMotionPhotoProtoPair(params: {
  jid: string;
  userJid?: string;
  stillMeta: {
    url: string;
    directPath: string;
    mediaKey: Uint8Array;
    fileSha256: Uint8Array;
    fileEncSha256: Uint8Array;
    fileLength: number;
    width: number;
    height: number;
    jpegThumbnail?: Uint8Array;
    caption?: string;
  };
  videoMeta: {
    url: string;
    directPath: string;
    mediaKey: Uint8Array;
    fileSha256: Uint8Array;
    fileEncSha256: Uint8Array;
    fileLength: number;
    width: number;
    height: number;
    seconds: number;
    presentationOffsetMs: number;
  };
}) {
  const parentMessageId = generateMessageIDV2();
  const childMessageId = generateMessageIDV2();

  const parentMsg = generateWAMessageFromContent(
    params.jid,
    {
      imageMessage: {
        url: params.stillMeta.url,
        directPath: params.stillMeta.directPath,
        mediaKey: params.stillMeta.mediaKey,
        fileSha256: params.stillMeta.fileSha256,
        fileEncSha256: params.stillMeta.fileEncSha256,
        fileLength: params.stillMeta.fileLength,
        mimetype: 'image/jpeg',
        width: params.stillMeta.width,
        height: params.stillMeta.height,
        jpegThumbnail: params.stillMeta.jpegThumbnail,
        caption: params.stillMeta.caption || '',
      },
      messageContextInfo: {
        messageSecret: crypto.randomBytes(32),
      },
    },
    {
      userJid: params.userJid || params.jid,
      messageId: parentMessageId,
    },
  );

  const childMsg = generateWAMessageFromContent(
    params.jid,
    {
      videoMessage: {
        url: params.videoMeta.url,
        directPath: params.videoMeta.directPath,
        mediaKey: params.videoMeta.mediaKey,
        fileSha256: params.videoMeta.fileSha256,
        fileEncSha256: params.videoMeta.fileEncSha256,
        fileLength: params.videoMeta.fileLength,
        mimetype: 'video/mp4',
        width: params.videoMeta.width,
        height: params.videoMeta.height,
        seconds: params.videoMeta.seconds,
        gifPlayback: false,
        motionPhotoPresentationOffsetMs: params.videoMeta.presentationOffsetMs,
      },
      messageContextInfo: {
        messageSecret: crypto.randomBytes(32),
        messageAssociation: {
          associationType: WAProto.MessageAssociation.AssociationType.MOTION_PHOTO,
          parentMessageKey: parentMsg.key,
          messageIndex: 0,
        },
      },
    },
    {
      userJid: params.userJid || params.jid,
      messageId: childMessageId,
    },
  );

  return {
    parentMsg,
    childMsg,
    parentEncodedBytes: Buffer.from(WAProto.Message.encode(parentMsg.message!).finish()),
    childEncodedBytes: Buffer.from(WAProto.Message.encode(childMsg.message!).finish()),
  };
}

export function buildSoundStickerProtoPayload(params: {
  stickerMeta: {
    url: string;
    directPath: string;
    mediaKey: Uint8Array;
    fileSha256: Uint8Array;
    fileEncSha256: Uint8Array;
    fileLength: number;
    width?: number;
    height?: number;
    isAnimated?: boolean;
    emojis?: string;
  };
  audioMeta: {
    url: string;
    directPath: string;
    mediaKey: Uint8Array;
    fileSha256: Uint8Array;
    fileEncSha256: Uint8Array;
    fileLength: number;
    seconds: number;
    waveform?: number[];
  };
  wrapFutureProofEnvelope?: boolean;
}) {
  installWhatsAppV5ProtoExtensions();

  const audioObj = WAProto.Message.AudioMessage.create({
    url: params.audioMeta.url,
    directPath: params.audioMeta.directPath,
    mediaKey: params.audioMeta.mediaKey,
    fileSha256: params.audioMeta.fileSha256,
    fileEncSha256: params.audioMeta.fileEncSha256,
    fileLength: params.audioMeta.fileLength,
    mimetype: 'audio/ogg; codecs=opus',
    ptt: false,
    seconds: params.audioMeta.seconds,
    waveform: params.audioMeta.waveform ? Uint8Array.from(params.audioMeta.waveform) : undefined,
  });

  const stickerObj: any = WAProto.Message.StickerMessage.create({
    url: params.stickerMeta.url,
    directPath: params.stickerMeta.directPath,
    mediaKey: params.stickerMeta.mediaKey,
    fileSha256: params.stickerMeta.fileSha256,
    fileEncSha256: params.stickerMeta.fileEncSha256,
    fileLength: params.stickerMeta.fileLength,
    mimetype: 'image/webp',
    width: params.stickerMeta.width ?? 512,
    height: params.stickerMeta.height ?? 512,
    isAnimated: params.stickerMeta.isAnimated ?? true,
    stickerSentTs: Date.now(),
  });
  stickerObj.emojis = params.stickerMeta.emojis || '🔊';
  stickerObj.audioMessage = audioObj;

  const msgObj: any = {
    stickerMessage: stickerObj,
    messageContextInfo: {
      messageSecret: crypto.randomBytes(32),
    },
  };

  if (params.wrapFutureProofEnvelope) {
    msgObj.audioStickerMessage = {
      message: {
        stickerMessage: stickerObj,
      },
    };
  }

  const encodedBytes = Buffer.from(WAProto.Message.encode(msgObj).finish());
  return {
    messageObject: msgObj,
    encodedBytes,
  };
}

export async function deliverMotionPhotoViaSocket(params: {
  sock: WASocket;
  jid: string;
  stillBuffer: Buffer;
  motionVideoBuffer: Buffer;
  width: number;
  height: number;
  durationMs: number;
  presentationOffsetMs: number;
  caption?: string;
}): Promise<{ ok: boolean; parentId?: string; childId?: string; error?: string }> {
  try {
    const upload = params.sock.waUploadToServer;
    const stillPrepared = await prepareWAMessageMedia(
      { image: params.stillBuffer },
      { upload },
    );
    const videoPrepared = await prepareWAMessageMedia(
      { video: params.motionVideoBuffer },
      { upload },
    );

    const imgM = stillPrepared.imageMessage!;
    const vidM = videoPrepared.videoMessage!;

    const pair = buildMotionPhotoProtoPair({
      jid: params.jid,
      userJid: params.sock.user?.id,
      stillMeta: {
        url: imgM.url || '',
        directPath: imgM.directPath || '',
        mediaKey: imgM.mediaKey || new Uint8Array(),
        fileSha256: imgM.fileSha256 || new Uint8Array(),
        fileEncSha256: imgM.fileEncSha256 || new Uint8Array(),
        fileLength: Number(imgM.fileLength || params.stillBuffer.length),
        width: params.width,
        height: params.height,
        jpegThumbnail: imgM.jpegThumbnail || undefined,
        caption: params.caption,
      },
      videoMeta: {
        url: vidM.url || '',
        directPath: vidM.directPath || '',
        mediaKey: vidM.mediaKey || new Uint8Array(),
        fileSha256: vidM.fileSha256 || new Uint8Array(),
        fileEncSha256: vidM.fileEncSha256 || new Uint8Array(),
        fileLength: Number(vidM.fileLength || params.motionVideoBuffer.length),
        width: params.width,
        height: params.height,
        seconds: Math.max(1, Math.round(params.durationMs / 1000)),
        presentationOffsetMs: params.presentationOffsetMs,
      },
    });

    await params.sock.relayMessage(params.jid, pair.parentMsg.message!, {
      messageId: pair.parentMsg.key.id!,
    });
    await params.sock.relayMessage(params.jid, pair.childMsg.message!, {
      messageId: pair.childMsg.key.id!,
    });

    return {
      ok: true,
      parentId: pair.parentMsg.key.id || undefined,
      childId: pair.childMsg.key.id || undefined,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Gagal mengirim Motion Photo via Baileys',
    };
  }
}

export async function deliverSoundStickerViaSocket(params: {
  sock: WASocket;
  jid: string;
  stickerBuffer: Buffer;
  audioBuffer: Buffer;
  audioSeconds: number;
  waveform: number[];
  quotedKey?: WAMessageKey;
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  try {
    installWhatsAppV5ProtoExtensions();
    const upload = params.sock.waUploadToServer;

    const stickerPrepared = await prepareWAMessageMedia(
      { sticker: params.stickerBuffer, isAnimated: true },
      { upload },
    );
    const audioPrepared = await prepareWAMessageMedia(
      { audio: params.audioBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: false },
      { upload },
    );

    const stkM = stickerPrepared.stickerMessage!;
    const audM = audioPrepared.audioMessage!;

    const built = buildSoundStickerProtoPayload({
      stickerMeta: {
        url: stkM.url || '',
        directPath: stkM.directPath || '',
        mediaKey: stkM.mediaKey || new Uint8Array(),
        fileSha256: stkM.fileSha256 || new Uint8Array(),
        fileEncSha256: stkM.fileEncSha256 || new Uint8Array(),
        fileLength: Number(stkM.fileLength || params.stickerBuffer.length),
        width: 512,
        height: 512,
        isAnimated: true,
        emojis: '🔊',
      },
      audioMeta: {
        url: audM.url || '',
        directPath: audM.directPath || '',
        mediaKey: audM.mediaKey || new Uint8Array(),
        fileSha256: audM.fileSha256 || new Uint8Array(),
        fileEncSha256: audM.fileEncSha256 || new Uint8Array(),
        fileLength: Number(audM.fileLength || params.audioBuffer.length),
        seconds: params.audioSeconds,
        waveform: params.waveform,
      },
      wrapFutureProofEnvelope: false,
    });

    const msgId = generateMessageIDV2();
    await params.sock.relayMessage(params.jid, built.messageObject, {
      messageId: msgId,
    });

    return { ok: true, messageId: msgId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Gagal mengirim Sound Sticker via Baileys',
    };
  }
}

export async function deliverLineSoundStickerComboViaSocket(params: {
  sock: WASocket;
  jid: string;
  stickerBuffer: Buffer;
  audioBuffer: Buffer;
  quoted?: any;
}): Promise<{ ok: boolean; stickerMsgId?: string; audioMsgId?: string; error?: string }> {
  const tmpPrefix = path.join(os.tmpdir(), `freya-line-sa-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
  const stickerPath = `${tmpPrefix}.webp`;
  const audioPath = `${tmpPrefix}.ogg`;

  try {
    fs.writeFileSync(stickerPath, params.stickerBuffer);
    fs.writeFileSync(audioPath, params.audioBuffer);

    const stickerRes = await params.sock.sendMessage(
      params.jid,
      { sticker: { url: stickerPath } },
      params.quoted ? { quoted: params.quoted } : undefined,
    );
    const audioRes = await params.sock.sendMessage(
      params.jid,
      { audio: { url: audioPath }, mimetype: 'audio/mp4', ptt: true },
      params.quoted ? { quoted: params.quoted } : undefined,
    );

    return {
      ok: true,
      stickerMsgId: stickerRes?.key?.id ?? undefined,
      audioMsgId: audioRes?.key?.id ?? undefined,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Gagal mengirim Kombo Stiker Bersuara via Baileys',
    };
  } finally {
    try {
      if (fs.existsSync(stickerPath)) fs.unlinkSync(stickerPath);
    } catch {
      // ignore temp cleanup error
    }
    try {
      if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
    } catch {
      // ignore temp cleanup error
    }
  }
}
