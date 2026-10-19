# Translation asset notices

The application retains the upstream MIT license in `LICENSE`. Game assets and translation-source material retain their respective licenses.

## Translation of GTNH

Chinese game terminology includes material from [Kiwi233/Translation-of-GTNH](https://github.com/Kiwi233/Translation-of-GTNH).

Copyright (c) 2022 Kiwi and the translation contributors credited by that project.
Its root code license is MIT; the complete notice is retained in
[docs/licenses/Kiwi-Translation-of-GTNH-MIT.txt](docs/licenses/Kiwi-Translation-of-GTNH-MIT.txt).
Its [README](https://github.com/Kiwi233/Translation-of-GTNH#汉化采用协议)
separately states that the translation material uses **CC-BY-NC-SA**, with no
version specified. Translation-derived dictionary material in this fork retains
the attribution, noncommercial and share-alike restrictions stated by its source.
The dictionaries were aligned and adapted for English-name lookup and composed
labels; their provenance is recorded in `src/lib/i18n/game-data.meta.json`.

## GT5-Unofficial

English language keys and name patterns used to align terminology originate from [GTNewHorizons/GT5-Unofficial](https://github.com/GTNewHorizons/GT5-Unofficial). Its source license is LGPL-3.0; the license text is retained in [docs/licenses/GT5-Unofficial-LGPL-3.0.txt](docs/licenses/GT5-Unofficial-LGPL-3.0.txt).

## Dictionary adaptation

The initial assets were adapted from the local `gtnh-planner-zh` project's dictionaries. Input hashes, source dataset alignment and generated asset hashes are recorded in `src/lib/i18n/game-data.meta.json`. `tools/i18n-game-data.mjs` performs the adaptation. Dictionary lookup matches and algorithmically composed names have separate quality categories; lookup precision does not imply manual certification.

GTNH, Minecraft, individual mod names, recipe exports and rendered item art remain subject to their owners' rights. Dataset downloads are separate from the repository and keep their original canonical identifiers and English source labels.

## pinyin-pro

Phonetic search uses [pinyin-pro](https://github.com/zh-lx/pinyin-pro), version 3.29.5.
Copyright (c) 2022-present zh-lx. MIT license; the complete notice is retained in
[docs/licenses/pinyin-pro-MIT.txt](docs/licenses/pinyin-pro-MIT.txt).
