# -*- mode: python ; coding: utf-8 -*-

a = Analysis(
    ['break_guard.py'],
    pathex=[],
    binaries=[],
    datas=[('app.ico', '.'), ('config.example.json', '.')],
    hiddenimports=['win32api', 'win32con', 'win32gui'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='BreakGuard',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    icon='app.ico',
)
