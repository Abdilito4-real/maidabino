# Mai-Dabino Clothing — Atelier

A mobile-first, offline-capable tailoring workspace built with semantic HTML, CSS and vanilla JavaScript.

## Run it

Open `index.html` in a modern browser. For the most reliable IndexedDB behavior, serve this folder from a local static web server (for example, `python -m http.server` from this directory) and open the local address. No build step, account, backend or network connection is required.

## Data and privacy

Customer records, measurement sheets, orders and payment history are stored in the browser's IndexedDB database. Preferences are stored in localStorage. Data stays in this browser profile and is not synchronized to other devices. Clearing browser site data removes the local records; use **Settings → Export backup** regularly to keep a copy. If browser storage is unavailable or full, save operations show an error instead of reporting success.

## PDF and printing

Open a saved order or measurement sheet and choose **Print / save PDF**. The browser's print dialog can send the clean A4 sheet to a printer or save it as a PDF. Enable background graphics if you want the green accent color included.

## Backup and restore

Settings can download a JSON backup containing records and preferences. Restore accepts an earlier backup and merges records by ID, preserving existing records not present in the file. The clear-data action is separate and asks for confirmation.

## Brand asset

`assets/mai-dabino-logo.jpeg` is the supplied official logo, used in the interface, favicon and printable measurement sheets without modification.
