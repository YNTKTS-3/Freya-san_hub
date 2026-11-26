#!/usr/bin/env python3
"""
Freya-san Hub v5.0 — Media Processing, Container Muxing & Validation Pipeline
Handles:
  1. `tolive`: Converts image or short video into:
     - `still.jpg` (keyframe cover JPEG)
     - `motion.mp4` (WhatsApp-compatible H.264/AAC MP4 for Motion Photo child)
     - `motion_photo.jpg` (Android MotionPhoto v1 + Legacy MicroVideo v1 XMP + appended MP4)
  2. `stickeraudio`: Converts video or visual+audio into:
     - `sticker.webp` (512x512 animated WebP <= 500 KB with VP8X, ANIM, ANMF & WhatsApp EXIF pack chunk)
     - `audio.ogg` (48kHz mono Opus OGG <= 10s + 64-byte WhatsApp waveform)
"""

import argparse
import hashlib
import json
import os
import struct
import subprocess
import sys
import tempfile
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path

MAX_INPUT_BYTES = 25 * 1024 * 1024
MAX_STICKER_BYTES = 500 * 1024
FFMPEG_TIMEOUT = 25


def run_cmd(cmd: list[str], timeout: int = FFMPEG_TIMEOUT) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
        check=False,
    )


def ffprobe_json(path: str) -> dict:
    proc = run_cmd(
        [
            "ffprobe",
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            path,
        ],
        timeout=10,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {proc.stderr.decode('utf-8', errors='replace')[:300]}")
    return json.loads(proc.stdout.decode("utf-8"))


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def build_motion_photo_xmp(mp4_length: int, presentation_us: int) -> bytes:
    xmp_xml = f'''<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 5.1.0-jc003">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:GCamera="http://ns.google.com/photos/1.0/camera/"
      xmlns:Container="http://ns.google.com/photos/1.0/container/"
      xmlns:Item="http://ns.google.com/photos/1.0/container/item/"
      GCamera:MotionPhoto="1"
      GCamera:MotionPhotoVersion="1"
      GCamera:MotionPhotoPresentationTimestampUs="{presentation_us}"
      GCamera:MicroVideo="1"
      GCamera:MicroVideoVersion="1"
      GCamera:MicroVideoOffset="{mp4_length}"
      GCamera:MicroVideoPresentationTimestampUs="{presentation_us}">
      <Container:Directory>
        <rdf:Seq>
          <rdf:li rdf:parseType="Resource">
            <Container:Item
              Item:Mime="image/jpeg"
              Item:Semantic="Primary"
              Item:Length="0"
              Item:Padding="0"/>
          </rdf:li>
          <rdf:li rdf:parseType="Resource">
            <Container:Item
              Item:Mime="video/mp4"
              Item:Semantic="MotionPhoto"
              Item:Length="{mp4_length}"
              Item:Padding="0"/>
          </rdf:li>
        </rdf:Seq>
      </Container:Directory>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>'''
    header = b"http://ns.adobe.com/xap/1.0/\x00"
    return header + xmp_xml.encode("utf-8")


def inject_xmp_and_mp4_into_jpeg(jpeg_bytes: bytes, mp4_bytes: bytes, presentation_us: int) -> bytes:
    if len(jpeg_bytes) < 4 or jpeg_bytes[:2] != b"\xff\xd8":
        raise ValueError("Invalid JPEG header (missing SOI 0xFFD8)")
    if jpeg_bytes[-2:] != b"\xff\xd9":
        # Some encoders may have trailing padding; find last EOI
        last_eoi = jpeg_bytes.rfind(b"\xff\xd9")
        if last_eoi < 2:
            raise ValueError("Invalid JPEG trailer (missing EOI 0xFFD9)")
        jpeg_bytes = jpeg_bytes[: last_eoi + 2]

    # Walk JPEG segments up to SOS (0xFFDA) and strip any prior Adobe XMP APP1
    cleaned_parts = [jpeg_bytes[:2]]
    pos = 2
    n = len(jpeg_bytes)
    while pos + 4 <= n:
        if jpeg_bytes[pos] != 0xFF:
            cleaned_parts.append(jpeg_bytes[pos:])
            break
        marker = jpeg_bytes[pos + 1]
        if marker == 0xDA or marker == 0xD9:
            cleaned_parts.append(jpeg_bytes[pos:])
            break
        if marker == 0x00 or (0xD0 <= marker <= 0xD7) or marker == 0x01:
            cleaned_parts.append(jpeg_bytes[pos : pos + 2])
            pos += 2
            continue
        seg_len = struct.unpack(">H", jpeg_bytes[pos + 2 : pos + 4])[0]
        seg_end = pos + 2 + seg_len
        if seg_end > n:
            cleaned_parts.append(jpeg_bytes[pos:])
            break
        is_existing_xmp = (
            marker == 0xE1
            and jpeg_bytes[pos + 4 : pos + 33] == b"http://ns.adobe.com/xap/1.0/\x00"
        )
        if not is_existing_xmp:
            cleaned_parts.append(jpeg_bytes[pos:seg_end])
        pos = seg_end

    xmp_payload = build_motion_photo_xmp(len(mp4_bytes), presentation_us)
    app1_segment = b"\xff\xe1" + struct.pack(">H", len(xmp_payload) + 2) + xmp_payload

    # Place APP1 XMP right after SOI
    final_jpeg = cleaned_parts[0] + app1_segment + b"".join(cleaned_parts[1:])
    return final_jpeg + mp4_bytes


def validate_motion_photo_container(container_path: str, tmp_dir: str) -> dict:
    data = Path(container_path).read_bytes()
    if data[:2] != b"\xff\xd8":
        return {"ok": False, "error": "Missing JPEG SOI"}
    xmp_marker = b"http://ns.adobe.com/xap/1.0/\x00"
    idx = data.find(xmp_marker)
    if idx < 0:
        return {"ok": False, "error": "Missing Adobe XMP APP1"}

    seg_len = struct.unpack(">H", data[idx - 2 : idx])[0]
    xmp_raw = data[idx + len(xmp_marker) : idx - 2 + seg_len].decode("utf-8", errors="replace")
    root = ET.fromstring(xmp_raw)
    desc = root.find(".//{http://www.w3.org/1999/02/22-rdf-syntax-ns#}Description")
    if desc is None:
        return {"ok": False, "error": "Missing XMP Description node"}

    motion_photo = desc.attrib.get("{http://ns.google.com/photos/1.0/camera/}MotionPhoto")
    offset_str = desc.attrib.get("{http://ns.google.com/photos/1.0/camera/}MicroVideoOffset")
    if motion_photo != "1" or not offset_str or not offset_str.isdigit():
        return {"ok": False, "error": "Missing MotionPhoto/MicroVideoOffset XMP tags"}

    offset = int(offset_str)
    if offset <= 16 or offset >= len(data):
        return {"ok": False, "error": f"Invalid MicroVideoOffset={offset}"}

    tail_mp4 = data[-offset:]
    if tail_mp4[4:8] != b"ftyp":
        return {"ok": False, "error": "Trailing bytes do not start with valid MP4 ftyp box"}

    verify_mp4 = os.path.join(tmp_dir, "verify_tail.mp4")
    Path(verify_mp4).write_bytes(tail_mp4)
    probe = ffprobe_json(verify_mp4)
    v_streams = [s for s in probe.get("streams", []) if s.get("codec_type") == "video"]
    if not v_streams:
        return {"ok": False, "error": "Embedded MP4 has no video stream"}

    return {
        "ok": True,
        "motionPhotoTag": motion_photo,
        "microVideoOffset": offset,
        "embeddedVideoCodec": v_streams[0].get("codec_name"),
        "embeddedDurationSec": float(probe.get("format", {}).get("duration") or 0),
    }


def process_tolive(input_path: str, outdir: str, kind: str, max_duration: float) -> dict:
    in_file = Path(input_path).resolve()
    if not in_file.is_file():
        return {"ok": False, "error": "Input file does not exist"}
    if in_file.stat().st_size > MAX_INPUT_BYTES:
        return {"ok": False, "error": "Input file exceeds 25 MB limit"}

    out_path = Path(outdir).resolve()
    out_path.mkdir(parents=True, exist_ok=True)
    still_path = str(out_path / "still.jpg")
    mp4_path = str(out_path / "motion.mp4")
    container_path = str(out_path / "motion_photo.jpg")

    probe = ffprobe_json(str(in_file))
    streams = probe.get("streams", [])
    v_streams = [s for s in streams if s.get("codec_type") == "video"]
    a_streams = [s for s in streams if s.get("codec_type") == "audio"]
    if not v_streams:
        return {"ok": False, "error": "No visual/video stream detected"}

    v_stream = v_streams[0]
    src_duration = float(probe.get("format", {}).get("duration") or 0.0)
    codec_name = str(v_stream.get("codec_name") or "").lower()
    nb_frames = int(v_stream.get("nb_frames") or 0) if str(v_stream.get("nb_frames") or "").isdigit() else 0

    is_video = (
        kind == "video"
        or (kind == "auto" and (codec_name in ("h264", "hevc", "vp8", "vp9", "av1", "mpeg4", "gif") and (src_duration > 0.25 or nb_frames > 1)))
    )

    with tempfile.TemporaryDirectory(prefix="freya-tolive-v-") as tmp_dir:
        if is_video:
            clip_dur = min(max_duration, max(0.8, src_duration if src_duration > 0 else 3.0))
            mid_sec = round(clip_dur / 2.0, 3)
            presentation_ms = int(round(mid_sec * 1000))

            # 1. Extract crisp cover keyframe JPEG
            p_still = run_cmd([
                "ffmpeg", "-y", "-ss", str(mid_sec), "-i", str(in_file),
                "-frames:v", "1",
                "-vf", "scale='min(1080,iw)':-2,format=yuvj420p",
                "-q:v", "2",
                still_path,
            ])
            if p_still.returncode != 0 or not Path(still_path).is_file():
                # Fallback to frame 0 if midpoint seek failed
                p_still = run_cmd([
                    "ffmpeg", "-y", "-i", str(in_file),
                    "-frames:v", "1",
                    "-vf", "scale='min(1080,iw)':-2,format=yuvj420p",
                    "-q:v", "2",
                    still_path,
                ])
                if p_still.returncode != 0:
                    return {"ok": False, "error": f"Cover frame extraction failed: {p_still.stderr.decode('utf-8', 'replace')[:240]}"}
                presentation_ms = 0

            # 2. Encode WhatsApp-compatible H.264/AAC MP4
            ff_mp4 = [
                "ffmpeg", "-y", "-i", str(in_file), "-t", str(clip_dur),
                "-vf", "scale='min(1080,iw)':-2:flags=lanczos,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
                "-c:v", "libx264", "-profile:v", "baseline", "-level", "3.1", "-preset", "veryfast", "-crf", "23",
            ]
            if a_streams:
                ff_mp4.extend(["-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2"])
            else:
                ff_mp4.append("-an")
            ff_mp4.extend(["-movflags", "+faststart", mp4_path])
            p_mp4 = run_cmd(ff_mp4)
            if p_mp4.returncode != 0:
                return {"ok": False, "error": f"MP4 encoding failed: {p_mp4.stderr.decode('utf-8', 'replace')[:240]}"}
        else:
            # Static image -> synthesize smooth Live-Photo micro-zoom MP4 (3.0s @ 30fps)
            presentation_ms = 0
            p_still = run_cmd([
                "ffmpeg", "-y", "-i", str(in_file),
                "-frames:v", "1",
                "-vf", "scale='min(1080,iw)':-2:flags=lanczos,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuvj420p",
                "-q:v", "2",
                still_path,
            ])
            if p_still.returncode != 0:
                return {"ok": False, "error": f"Still JPEG normalization failed: {p_still.stderr.decode('utf-8', 'replace')[:240]}"}

            still_probe = ffprobe_json(still_path)
            st_v = [s for s in still_probe.get("streams", []) if s.get("codec_type") == "video"][0]
            w = max(64, int(st_v.get("width") or 720))
            h = max(64, int(st_v.get("height") or 720))
            w = w - (w % 2)
            h = h - (h % 2)

            p_mp4 = run_cmd([
                "ffmpeg", "-y", "-loop", "1", "-i", still_path,
                "-vf", f"zoompan=z='1+0.06*(on/90)':d=90:fps=30:s={w}x{h},format=yuv420p",
                "-t", "3.0",
                "-c:v", "libx264", "-profile:v", "baseline", "-level", "3.1", "-preset", "veryfast", "-crf", "22",
                "-an", "-movflags", "+faststart", mp4_path,
            ])
            if p_mp4.returncode != 0:
                return {"ok": False, "error": f"Live motion synthesis failed: {p_mp4.stderr.decode('utf-8', 'replace')[:240]}"}

        still_bytes = Path(still_path).read_bytes()
        mp4_bytes = Path(mp4_path).read_bytes()
        container_bytes = inject_xmp_and_mp4_into_jpeg(still_bytes, mp4_bytes, presentation_ms * 1000)
        Path(container_path).write_bytes(container_bytes)

        val_container = validate_motion_photo_container(container_path, tmp_dir)
        mp4_probe = ffprobe_json(mp4_path)
        mp4_v = [s for s in mp4_probe.get("streams", []) if s.get("codec_type") == "video"][0]
        mp4_a = [s for s in mp4_probe.get("streams", []) if s.get("codec_type") == "audio"]
        dur_ms = int(round(float(mp4_probe.get("format", {}).get("duration") or 3.0) * 1000))

        return {
            "ok": bool(val_container.get("ok")),
            "inputKind": "video" if is_video else "image",
            "stillPath": still_path,
            "motionMp4Path": mp4_path,
            "motionPhotoJpgPath": container_path,
            "stillBytes": len(still_bytes),
            "motionMp4Bytes": len(mp4_bytes),
            "motionPhotoJpgBytes": len(container_bytes),
            "width": int(mp4_v.get("width") or 0),
            "height": int(mp4_v.get("height") or 0),
            "durationMs": dur_ms,
            "presentationOffsetMs": presentation_ms,
            "hasAudio": len(mp4_a) > 0,
            "validation": val_container,
            "error": None if val_container.get("ok") else val_container.get("error"),
        }


def build_whatsapp_sticker_exif(pack_name: str, pack_publisher: str, emojis: list[str]) -> bytes:
    payload = {
        "sticker-pack-id": f"freya.hub.{uuid.uuid4().hex[:12]}",
        "sticker-pack-name": pack_name,
        "sticker-pack-publisher": pack_publisher,
        "emojis": emojis,
    }
    json_bytes = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    exif_header = bytearray([
        0x49, 0x49, 0x2A, 0x00,
        0x08, 0x00, 0x00, 0x00,
        0x01, 0x00,
        0x41, 0x57,
        0x07, 0x00,
    ])
    exif_header += struct.pack("<I", len(json_bytes))
    exif_header += struct.pack("<I", 22)  # Offset to JSON data
    return bytes(exif_header) + json_bytes


def inject_exif_into_webp(webp_bytes: bytes, exif_bytes: bytes) -> bytes:
    if len(webp_bytes) < 12 or webp_bytes[:4] != b"RIFF" or webp_bytes[8:12] != b"WEBP":
        raise ValueError("Invalid WebP RIFF container")

    chunks = []
    pos = 12
    n = len(webp_bytes)
    has_vp8x = False
    vp8x_data = None
    width = 512
    height = 512

    while pos + 8 <= n:
        fourcc = webp_bytes[pos : pos + 4]
        chunk_size = struct.unpack("<I", webp_bytes[pos + 4 : pos + 8])[0]
        padded = chunk_size + (chunk_size % 2)
        chunk_data = webp_bytes[pos + 8 : pos + 8 + chunk_size]
        pos += 8 + padded
        if fourcc == b"EXIF":
            continue
        if fourcc == b"VP8X" and len(chunk_data) >= 10:
            has_vp8x = True
            ba = bytearray(chunk_data)
            ba[0] = ba[0] | 0x08  # Set EXIF bit (bit 3)
            vp8x_data = bytes(ba)
            continue
        chunks.append((fourcc, chunk_data))

    body = bytearray()
    if has_vp8x and vp8x_data is not None:
        body += b"VP8X" + struct.pack("<I", len(vp8x_data)) + vp8x_data
        if len(vp8x_data) % 2:
            body += b"\x00"
    else:
        # Synthesize VP8X header with EXIF bit + 512x512 canvas
        vp8x = bytearray(10)
        vp8x[0] = 0x08  # EXIF flag
        w_m1 = width - 1
        h_m1 = height - 1
        vp8x[4:7] = struct.pack("<I", w_m1)[:3]
        vp8x[7:10] = struct.pack("<I", h_m1)[:3]
        body += b"VP8X" + struct.pack("<I", 10) + bytes(vp8x)

    for fourcc, cdata in chunks:
        body += fourcc + struct.pack("<I", len(cdata)) + cdata
        if len(cdata) % 2:
            body += b"\x00"

    body += b"EXIF" + struct.pack("<I", len(exif_bytes)) + exif_bytes
    if len(exif_bytes) % 2:
        body += b"\x00"

    total_size = 4 + len(body)
    return b"RIFF" + struct.pack("<I", total_size) + b"WEBP" + bytes(body)


def inspect_webp_chunks(webp_bytes: bytes) -> dict:
    if len(webp_bytes) < 12 or webp_bytes[:4] != b"RIFF" or webp_bytes[8:12] != b"WEBP":
        return {"ok": False, "error": "Invalid RIFF/WEBP signature"}
    chunks = []
    pos = 12
    n = len(webp_bytes)
    width = 0
    height = 0
    exif_json = None
    anmf_count = 0

    while pos + 8 <= n:
        fourcc = webp_bytes[pos : pos + 4].decode("ascii", errors="replace")
        chunk_size = struct.unpack("<I", webp_bytes[pos + 4 : pos + 8])[0]
        cdata = webp_bytes[pos + 8 : pos + 8 + chunk_size]
        chunks.append(fourcc)
        if fourcc == "VP8X" and len(cdata) >= 10:
            width = int.from_bytes(cdata[4:7], "little") + 1
            height = int.from_bytes(cdata[7:10], "little") + 1
        elif fourcc == "ANMF":
            anmf_count += 1
        elif fourcc == "EXIF" and len(cdata) > 22:
            try:
                exif_json = json.loads(cdata[22:].decode("utf-8"))
            except Exception:
                exif_json = None
        pos += 8 + chunk_size + (chunk_size % 2)

    is_animated = "ANIM" in chunks and anmf_count > 0
    ok = (
        len(webp_bytes) <= MAX_STICKER_BYTES
        and "EXIF" in chunks
        and exif_json is not None
        and (width == 512 or width == 0)
    )
    return {
        "ok": ok,
        "chunks": chunks,
        "anmfFrames": anmf_count,
        "isAnimated": is_animated,
        "width": width or 512,
        "height": height or 512,
        "hasWhatsAppExif": exif_json is not None,
        "packName": exif_json.get("sticker-pack-name") if exif_json else None,
        "sizeBytes": len(webp_bytes),
    }


def compute_opus_waveform(audio_ogg_path: str) -> list[int]:
    proc = run_cmd([
        "ffmpeg", "-y", "-i", audio_ogg_path,
        "-ac", "1", "-ar", "8000", "-f", "s16le", "pipe:1",
    ], timeout=10)
    raw = proc.stdout
    if len(raw) < 128:
        return [15] * 64
    samples = struct.unpack(f"<{len(raw) // 2}h", raw[: (len(raw) // 2) * 2])
    bucket_size = max(1, len(samples) // 64)
    waveform = []
    for i in range(64):
        seg = samples[i * bucket_size : (i + 1) * bucket_size]
        if not seg:
            waveform.append(5)
            continue
        peak = max(abs(x) for x in seg)
        val = int(min(100, max(2, round((peak / 32768.0) * 100))))
        waveform.append(val)
    return waveform


def process_stickeraudio(
    visual_path: str,
    audio_path: str | None,
    outdir: str,
    pack_name: str,
    pack_publisher: str,
    max_duration: float,
) -> dict:
    v_file = Path(visual_path).resolve()
    if not v_file.is_file():
        return {"ok": False, "error": "Visual input file missing"}
    if v_file.stat().st_size > MAX_INPUT_BYTES:
        return {"ok": False, "error": "Visual input exceeds 25 MB"}

    a_source = str(Path(audio_path).resolve()) if audio_path else str(v_file)
    if audio_path and not Path(a_source).is_file():
        return {"ok": False, "error": "Audio input file missing"}
    if audio_path and Path(a_source).stat().st_size > MAX_INPUT_BYTES:
        return {"ok": False, "error": "Audio input exceeds 25 MB"}

    v_probe = ffprobe_json(str(v_file))
    v_streams = [s for s in v_probe.get("streams", []) if s.get("codec_type") == "video"]
    if not v_streams:
        return {"ok": False, "error": "No visual/video stream in visual input"}

    a_probe = ffprobe_json(a_source)
    a_streams = [s for s in a_probe.get("streams", []) if s.get("codec_type") == "audio"]
    if not a_streams:
        return {"ok": False, "error": "No audio stream detected in source or paired audio"}

    out_path = Path(outdir).resolve()
    out_path.mkdir(parents=True, exist_ok=True)
    webp_path = str(out_path / "sticker.webp")
    ogg_path = str(out_path / "audio.ogg")

    v_codec = str(v_streams[0].get("codec_name") or "").lower()
    v_dur = float(v_probe.get("format", {}).get("duration") or 0.0)
    nb_frames = int(v_streams[0].get("nb_frames") or 0) if str(v_streams[0].get("nb_frames") or "").isdigit() else 0
    is_animated_src = v_codec in ("h264", "hevc", "vp8", "vp9", "av1", "mpeg4", "gif", "webp") and (v_dur > 0.25 or nb_frames > 1)

    a_dur = float(a_probe.get("format", {}).get("duration") or 3.0)
    target_audio_dur = min(10.0, max(0.5, a_dur))

    # 1. Encode audio track -> OGG/Opus (48kHz mono)
    p_ogg = run_cmd([
        "ffmpeg", "-y", "-i", a_source, "-vn",
        "-t", str(target_audio_dur),
        "-c:a", "libopus", "-ar", "48000", "-ac", "1", "-b:a", "32k", "-application", "voip",
        ogg_path,
    ])
    if p_ogg.returncode != 0 or not Path(ogg_path).is_file():
        return {"ok": False, "error": f"Opus audio encoding failed: {p_ogg.stderr.decode('utf-8', 'replace')[:240]}"}

    # 2. Encode visual -> 512x512 Animated WebP strictly under 500 KB
    exif_bytes = build_whatsapp_sticker_exif(pack_name, pack_publisher, ["🔊", "✨"])
    attempts = [
        (15, 62, min(max_duration, 8.0)),
        (12, 45, min(max_duration, 6.0)),
        (10, 32, min(max_duration, 5.0)),
        (8, 22, min(max_duration, 4.0)),
    ]

    final_webp_bytes: bytes | None = None
    last_err = ""
    for fps, quality, dur in attempts:
        if is_animated_src:
            vf = (
                f"fps={fps},"
                "scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos,"
                "pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,"
                "setsar=1,format=yuva420p"
            )
            ff_webp = [
                "ffmpeg", "-y", "-i", str(v_file), "-t", str(dur),
                "-vf", vf,
                "-vcodec", "libwebp", "-lossless", "0", "-compression_level", "4",
                "-q:v", str(quality), "-loop", "0", "-preset", "default", "-an",
                webp_path,
            ]
        else:
            # Synthesize gentle animated sticker loop from static image so #sa is always animated
            total_frames = max(12, int(round(min(2.0, dur) * fps)))
            vf = (
                "scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos,"
                "pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,"
                f"zoompan=z='1+0.04*sin(on/{total_frames}*3.14159)':d={total_frames}:fps={fps}:s=512x512,"
                "setsar=1,format=yuva420p"
            )
            ff_webp = [
                "ffmpeg", "-y", "-loop", "1", "-i", str(v_file),
                "-vf", vf, "-t", str(min(2.0, dur)),
                "-vcodec", "libwebp", "-lossless", "0", "-compression_level", "4",
                "-q:v", str(quality), "-loop", "0", "-an",
                webp_path,
            ]

        p_webp = run_cmd(ff_webp)
        if p_webp.returncode != 0 or not Path(webp_path).is_file():
            last_err = p_webp.stderr.decode("utf-8", "replace")[:240]
            continue
        raw_webp = Path(webp_path).read_bytes()
        with_exif = inject_exif_into_webp(raw_webp, exif_bytes)
        if len(with_exif) <= MAX_STICKER_BYTES:
            final_webp_bytes = with_exif
            Path(webp_path).write_bytes(with_exif)
            break

    if final_webp_bytes is None:
        return {"ok": False, "error": f"Failed to produce <500KB animated WebP sticker: {last_err}"}

    webp_val = inspect_webp_chunks(final_webp_bytes)
    ogg_probe = ffprobe_json(ogg_path)
    ogg_a = [s for s in ogg_probe.get("streams", []) if s.get("codec_type") == "audio"]
    ogg_bytes = Path(ogg_path).read_bytes()
    waveform = compute_opus_waveform(ogg_path)
    audio_dur_sec = max(1, int(round(float(ogg_probe.get("format", {}).get("duration") or 1.0))))

    audio_val = {
        "ok": ogg_bytes[:4] == b"OggS" and len(ogg_a) > 0 and ogg_a[0].get("codec_name") == "opus",
        "codec": ogg_a[0].get("codec_name") if ogg_a else None,
        "sampleRate": int(ogg_a[0].get("sample_rate") or 48000) if ogg_a else 0,
        "channels": int(ogg_a[0].get("channels") or 1) if ogg_a else 0,
        "durationSeconds": audio_dur_sec,
        "sizeBytes": len(ogg_bytes),
    }

    overall_ok = bool(webp_val.get("ok") and webp_val.get("isAnimated") and audio_val["ok"])
    return {
        "ok": overall_ok,
        "stickerPath": webp_path,
        "audioPath": ogg_path,
        "stickerBytes": len(final_webp_bytes),
        "audioBytes": len(ogg_bytes),
        "stickerSha256": sha256_file(webp_path),
        "audioSha256": sha256_file(ogg_path),
        "audioSeconds": audio_dur_sec,
        "waveform": waveform,
        "webpValidation": webp_val,
        "audioValidation": audio_val,
        "error": None if overall_ok else "Media container failed strict validation",
    }


def main():
    parser = argparse.ArgumentParser(description="Freya-san Hub Media Pipeline")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_live = sub.add_parser("tolive")
    p_live.add_argument("--input", required=True)
    p_live.add_argument("--outdir", required=True)
    p_live.add_argument("--kind", default="auto", choices=["auto", "image", "video"])
    p_live.add_argument("--max-duration", type=float, default=4.0)

    p_sa = sub.add_parser("stickeraudio")
    p_sa.add_argument("--visual", required=True)
    p_sa.add_argument("--audio", default="")
    p_sa.add_argument("--outdir", required=True)
    p_sa.add_argument("--pack-name", default="Freya-san Hub v5.0")
    p_sa.add_argument("--pack-publisher", default="Freya-san bot by Pak Ujan")
    p_sa.add_argument("--max-duration", type=float, default=8.0)

    args = parser.parse_args()
    try:
        if args.cmd == "tolive":
            res = process_tolive(args.input, args.outdir, args.kind, args.max_duration)
        else:
            res = process_stickeraudio(
                args.visual,
                args.audio or None,
                args.outdir,
                args.pack_name,
                args.pack_publisher,
                args.max_duration,
            )
    except Exception as exc:
        res = {"ok": False, "error": str(exc)}

    print(json.dumps(res))
    sys.exit(0 if res.get("ok") else 1)


if __name__ == "__main__":
    main()
