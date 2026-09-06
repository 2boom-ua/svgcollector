<div align="center">  
    <img src="https://github.com/2boom-ua/svgcollector/blob/main/icons/icon128.png?raw=true" alt="" width="128" height="128">
</div>

# SVG Collector

![Version](https://img.shields.io/badge/version-1.0-green.svg)

**SVG Collector** is a Chrome / Edge browser extension designed to discover, preview, inspect, and export SVG vectors directly from any web page.

## Features

- **Comprehensive Detection**: Scans and collects SVGs across multiple HTML and CSS sources:
  - Inline `<svg>` elements.
  - Image tags (`<img src="...svg">` and `srcset`).
  - CSS background images (`background-image: url(...)`).
  - Embedded elements (`<object>` and `<embed>`).
  - SVG sprites and references (`<use href="...svg">`).
- **Color Mode Detection**: Automatically distinguishes single-color SVGs from multi-color or gradient-based SVGs.
- **Detailed Metadata**: Displays image dimensions, file size, duplicate count, and source URLs.
- **Interactive Preview & Inspector**: Built-in modal window to inspect SVG previews, view dimensions, and examine unique IDs.
- **One-Click Export**: Quickly copy raw SVG code to clipboard or download files directly.
- **Dark & Light Mode Support**: Fully reactive user interface adapting seamlessly to browser theme preferences.

## Extension Structure

```text
├── background.js     # Background Service Worker (manages sidePanel & messaging)
├── content.js        # Content script for DOM scanning and SVG parsing
├── sidepanel.html    # Main UI markup for the Side Panel
├── sidepanel.css     # Responsive styles with dark/light theme support
├── sidepanel.js      # Side Panel UI control logic and event handling
├── manifest.json     # Extension Manifest V3 configuration
└── icons/            # Extension UI icons
```

## From Chrome Web Store or Edge Add-ons

Comming soon

## Manual Installation (Developer Mode)

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select the project folder.
5. Click the extension icon in the toolbar to open the side panel.

## Permissions
- sidePanel: Used to display the SVG Inspector UI in the browser side panel.
- activeTab & scripting: Required to scan the active page's DOM for SVG assets.
- downloads: Enables direct downloading of SVG files.
- clipboardWrite: Allows copying raw SVG markup directly to your clipboard.
- storage: Preserves user preferences and session states.
- <all_urls> host permission: Needed to fetch externally referenced SVG assets cross-origin.

## License

Copyright © 2boom, 2026.
