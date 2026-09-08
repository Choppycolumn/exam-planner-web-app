from __future__ import annotations

import io
import logging
import re
from typing import Optional

log = logging.getLogger("seatbot")

_ocr = None


def _get_ocr():
    global _ocr
    if _ocr is None:
        import ddddocr

        _ocr = ddddocr.DdddOcr(show_ad=False)
    return _ocr


def _digits(text: Optional[str]) -> str:
    return re.sub(r"\D", "", text or "")


def recognize(image_bytes: bytes) -> Optional[str]:
    """识别图书馆静态 4 位数字验证码。"""
    try:
        text = _get_ocr().classification(image_bytes)
    except Exception as exc:
        log.warning("OCR 异常: %s", exc)
        return None
    digits = _digits(text)
    if len(digits) >= 4:
        return digits[:4]
    if len(digits) == 3:
        return digits
    return None


def _load_frames(image_bytes: bytes) -> list:
    from PIL import Image

    im = Image.open(io.BytesIO(image_bytes))
    frames = []
    try:
        i = 0
        while True:
            frames.append(im.convert("RGBA").copy())
            i += 1
            im.seek(i)
    except EOFError:
        pass
    except Exception:
        if not frames:
            frames = [im.convert("RGBA")]
    if not frames:
        frames = [Image.open(io.BytesIO(image_bytes)).convert("RGBA")]
    return frames


def stack_gif_frames(image_bytes: bytes) -> bytes:
    """GIF 各帧叠成一张：每帧只显示部分数字，叠完应出现完整码。"""
    from PIL import Image
    import numpy as np

    frames = _load_frames(image_bytes)
    log.info("CAS 验证码帧数=%s", len(frames))
    grays = [f.convert("L") for f in frames]
    w, h = grays[0].size
    acc = np.full((h, w), 255, dtype=np.uint8)
    for g in grays:
        arr = np.array(g.resize((w, h)), dtype=np.uint8)
        acc = np.minimum(acc, arr)

    stacked = Image.fromarray(acc, mode="L")
    stacked = stacked.resize((w * 3, h * 3), Image.Resampling.LANCZOS)
    try:
        from PIL import ImageEnhance

        stacked = ImageEnhance.Contrast(stacked).enhance(1.8)
    except Exception:
        pass
    buf = io.BytesIO()
    stacked.save(buf, format="PNG")
    return buf.getvalue()


def _ocr_many(image_bytes: bytes) -> str:
    ocr = _get_ocr()
    best = ""
    candidates = [image_bytes]
    try:
        from PIL import Image, ImageEnhance, ImageOps

        im = Image.open(io.BytesIO(image_bytes)).convert("L")
        for scale in (1.0, 2.0, 3.0):
            w, h = im.size
            scaled = im.resize(
                (max(1, int(w * scale)), max(1, int(h * scale))),
                Image.Resampling.LANCZOS,
            )
            for enh in (1.0, 1.8, 2.5):
                img = ImageEnhance.Contrast(scaled).enhance(enh)
                b = io.BytesIO()
                img.save(b, format="PNG")
                candidates.append(b.getvalue())
            bw = ImageOps.autocontrast(scaled).point(lambda x: 255 if x > 160 else 0)
            b = io.BytesIO()
            bw.save(b, format="PNG")
            candidates.append(b.getvalue())
    except Exception as exc:
        log.debug("预处理跳过: %s", exc)

    for var in candidates:
        try:
            text = ocr.classification(var)
        except Exception:
            continue
        d = _digits(text)
        if len(d) > len(best):
            best = d
        if len(d) >= 4:
            return d[:4]
    return best


def recognize_cas(image_bytes: bytes) -> Optional[str]:
    """CAS GIF：多帧堆叠后再 OCR，目标 4 位。"""
    try:
        stacked = stack_gif_frames(image_bytes)
    except Exception as exc:
        log.warning("GIF 叠帧失败，改用原图: %s", exc)
        stacked = image_bytes

    try:
        from pathlib import Path

        Path("logs").mkdir(parents=True, exist_ok=True)
        Path("logs/cas_stacked.png").write_bytes(stacked)
    except Exception:
        pass

    best = _ocr_many(stacked)
    if len(best) < 4:
        try:
            parts = []
            for fr in _load_frames(image_bytes):
                buf = io.BytesIO()
                fr.convert("RGB").save(buf, format="PNG")
                p = _ocr_many(buf.getvalue())
                if p:
                    parts.append(p)
            d = _digits("".join(parts))
            if len(d) > len(best):
                best = d
        except Exception as exc:
            log.debug("分帧 OCR 失败: %s", exc)

    if len(best) >= 4:
        log.info("CAS OCR 成功(叠帧)=%s", best[:4])
        return best[:4]
    if best:
        log.warning("CAS OCR 仅 %s 位: %s（见 logs/cas_stacked.png）", len(best), best)
        return best
    return None
