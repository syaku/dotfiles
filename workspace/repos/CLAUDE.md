# CLAUDE.md

このファイルは `repos/` ディレクトリで作業する際の Claude Code へのガイダンスを提供します。

## 概要

ghq で管理する開発リポジトリのルートディレクトリ（`ghq.root = ~/workspace/repos`）。

## ディレクトリ構成

ghq の規約に従って `<host>/<owner>/<repo>/` の階層で配置される。

```
repos/
└── <host>/             例: github.com, gitlab.com, fly.io
    └── <owner>/        例: syaku
        └── <repo>/     リポジトリ本体
```

リポジトリの追加・クローンは `ghq get <url>` で行う。一覧は `ghq list` で取得できるため、このファイルでリポジトリ一覧を保守はしない。

各リポジトリ固有の説明は当該リポジトリ直下の `CLAUDE.md` を参照。
