# Woodwork Serif Heavy

Locally hosted, renamed subset of Noto Serif SC 900, supplied by Google Fonts:
https://fonts.google.com/specimen/Noto+Serif+SC

Source: https://fonts.gstatic.com/s/notoserifsc/v36/H4cyBXePl9DZ0Xe7gG9cyOj7uK2-n-D2rd4FY7QrrCWv.ttf

Licensed under the SIL Open Font License 1.1; see OFL.txt. The subset contains ASCII and the Chinese characters used in the application source. User-defined names and any characters outside that subset fall back to Noto Serif SC, Songti SC, STSong or the system serif font. Controls use the system sans-serif font.

The subset covers all current interface Han characters and retains previously included characters (713 mapped characters in total), including 组、装、品. Existing glyph outlines, spacing, family name and 900 weight are preserved. User-defined text outside the subset still uses the declared serif fallback.

Check coverage after adding interface text, using Python with `fonttools[woff]` installed:

```sh
python3 scripts/subset-display-font.py
```

To rebuild, download the original TTF from the source URL above, then run:

```sh
python3 scripts/subset-display-font.py --source /path/to/NotoSerifSC-Black.ttf
```

The script retains previously included characters, adds Han characters from current source files, preserves the renamed family metadata, and updates matching font cache versions in the stylesheet and preload. No font-processing dependency is needed by the application.

The original typeface is not an exact identification of the font in the user's reference image.
