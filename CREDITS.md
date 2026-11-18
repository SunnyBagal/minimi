# Credits

Third-party pieces used in the chat page. Everything else in the page, including the drifting ASCII cats (`app/components/catFrames.ts`), was written for this project.

## oneko.js

The cat that chases the pointer.

- Source: https://github.com/adryd325/oneko.js (`oneko.js` and `oneko.gif` on `main`, fetched 2026-11-18)
- Used as: the original sprite sheet in `public/oneko/oneko.gif`, with the licence in `public/oneko/LICENSE`, and its sheet offsets in `app/components/onekoCore.ts`.
- Behaviour: the cat's movement and phases (running, idle, tired, sleeping, alert) come from the `useNeko` hook in the site owner's portfolio code (`src/components/sections/hero.js`, follow mode), which uses this sprite sheet. It is ported to TypeScript in `app/components/onekoCore.ts` (logic) and `app/components/Oneko.tsx` (drawing). Keeping the cat beside the conversation column (`app/components/nekoColumn.ts`) was written for this project.
- Licence: MIT

```
Copyright © 2022 adryd

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## ASCII Magic: "Sleeping Cat" and "Cat at the Keyboard"

The two animated pieces in the bottom side gutters on wide screens. Art by ASCII Magic, https://www.ascii-magic.com.

- Sleeping Cat: https://www.ascii-magic.com/ascii/sleeping-cat
- Cat at the Keyboard: https://www.ascii-magic.com/ascii/laptop-typing-cat
- Source repository: https://github.com/kailashsr38/ascii-magic-art (`pieces/sleeping-cat.js`, `pieces/laptop-typing-cat.js`)
- Used as: the text layer of the published frames, stored in `app/components/asciiMagicPieces.ts` and played by `app/components/GutterPieces.tsx`. The header of the data file says how the frames were taken.
- Licence: MIT

```
MIT License

Copyright (c) 2026 ASCII Magic (ascii-magic.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
