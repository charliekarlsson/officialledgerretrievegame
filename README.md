# Retrieve the Ledger

A small HTML5 canvas fighting demo. Play as the soap and defeat the man.

## Run
- Open `index.html` in your browser.
- The game renders directly on the page (no popup).

## Controls
- Left/Right: Move
- Space: Attack
- T: Taunt
- R: Restart after KO

## Rules and AI
- The enemy walks toward you and attacks when in range.
- Taunting stuns the enemy briefly and makes him play his taunt animation.
- First to 0 HP loses. When the man is KO’d, he plays his "giveup" animation. Restart with R or by clicking the canvas.

## Assets
Sprites are under `spritesheets/Characters/...`. The engine slices exactly one 80x80 frame at a time. If the file name ends with a number (e.g. `attack_6.png`), that number is used as the frame count.

## Troubleshooting
- If sprites don’t show: verify the image paths in `main.js` match your folders.
- If audio doesn’t play: click or press any key once to allow sound, then check files exist in `audio/` with names like `soap_attack.(wav|mp3|ogg)` and `man_taunt.(wav|mp3|ogg)`.
