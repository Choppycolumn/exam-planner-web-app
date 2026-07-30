# Apple-Inspired Interface System

This project uses one shared visual foundation for the web application and a
matching native drawing system for Break Guard. Business logic, routes, storage,
and notification behavior remain outside the design layer.

## Web

- `src/styles/apple-tokens.css` defines color, material, radius, spacing,
  typography, and motion tokens for light and dark themes.
- `src/styles/apple-components.css` styles the application shell, navigation,
  cards, controls, fields, tables, alerts, and shared states.
- `src/styles/apple-focus.css` applies the same hierarchy to the web focus timer.
- `src/styles/apple-design.css` is the single design-system entry point.

The material hierarchy is background, structural chrome, content surface, then
controls. Nested cards do not stack backdrop blur. Press feedback starts on the
active pointer state, while reduced motion, reduced transparency, increased
contrast, unsupported backdrop filters, mobile safe areas, and keyboard focus
all have explicit fallbacks.

## Break Guard

- `desktop-break-guard/liquid_style.py` owns native color, spacing, radius,
  typography, motion, and drawing primitives.
- `desktop-break-guard/breakguard_view.py` owns the main, compact, break, and
  full-screen reminder presentation.
- `desktop-break-guard/breakguard_settings.py` owns the secondary settings UI.

Break Guard uses bounded canvas gradients and a single material surface to keep
resize and redraw work predictable. Buttons expose immediate pressed feedback.
The operating-system app theme selects the light or dark token set.

## Verification

```powershell
npm run lint
npm run test
npm run build
npm run e2e
npm run visual:capture

Set-Location desktop-break-guard
python -m unittest discover -s tests -v
powershell -ExecutionPolicy Bypass -File .\build.ps1
```

Visual captures are written to `test-results/apple-design`. Break Guard visual
QA uses an isolated `%LOCALAPPDATA%` root so it cannot alter real study data.
