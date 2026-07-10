from __future__ import annotations

import base64
import ctypes
import sys
from ctypes import wintypes


class DATA_BLOB(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]


def _blob(data: bytes):
    buffer = ctypes.create_string_buffer(data)
    return DATA_BLOB(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_byte))), buffer


def protect_secret(value: str) -> str:
    if not value:
        return ""
    if not sys.platform.startswith("win"):
        return "plain:" + base64.b64encode(value.encode("utf-8")).decode("ascii")
    source, source_buffer = _blob(value.encode("utf-8"))
    target = DATA_BLOB()
    if not ctypes.windll.crypt32.CryptProtectData(ctypes.byref(source), "Break Guard", None, None, None, 0, ctypes.byref(target)):
        raise ctypes.WinError()
    try:
        encrypted = ctypes.string_at(target.pbData, target.cbData)
        return "dpapi:" + base64.b64encode(encrypted).decode("ascii")
    finally:
        ctypes.windll.kernel32.LocalFree(target.pbData)
        del source_buffer


def unprotect_secret(value: str) -> str:
    if not value:
        return ""
    if value.startswith("plain:"):
        return base64.b64decode(value[6:]).decode("utf-8")
    if not value.startswith("dpapi:") or not sys.platform.startswith("win"):
        return ""
    encrypted = base64.b64decode(value[6:])
    source, source_buffer = _blob(encrypted)
    target = DATA_BLOB()
    if not ctypes.windll.crypt32.CryptUnprotectData(ctypes.byref(source), None, None, None, None, 0, ctypes.byref(target)):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(target.pbData, target.cbData).decode("utf-8")
    finally:
        ctypes.windll.kernel32.LocalFree(target.pbData)
        del source_buffer
