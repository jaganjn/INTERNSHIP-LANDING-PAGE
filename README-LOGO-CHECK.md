# InternsForge Website — Logo & Asset Reliability Check

## Fixed
- Removed the broken `adobe.png` dependency from the technology ecosystem strip.
- Added a local Adobe wordmark fallback so the ecosystem card never renders a broken image icon.
- Made the first marquee group load eagerly and decode asynchronously for more reliable first-viewport rendering.
- Kept the duplicated marquee group for seamless animation; the repeated brands are intentional.

## Validation
- Scanned HTML/CSS/JS for local asset references.
- Remaining reported template-like strings such as `${whatsappUrl}` are runtime JavaScript values, not missing files.
- JavaScript files pass `node --check`.
- Firebase rules and config JSON parse successfully.
