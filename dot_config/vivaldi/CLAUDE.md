# CLAUDE.md — Vivaldi カスタマイズ

このディレクトリは Vivaldi の UI モディフィケーション（`custom.css`）置き場。Vivaldi の設定で「Allow CSS modifications from」をこのディレクトリに向けている。

## 現在の構成

`custom.css` は **phi-for-vivaldi (KaKi87)** 本体を配置している。
- リポジトリ: https://git.kaki87.net/KaKi87/phi-for-vivaldi
- 自前で大きく書き換えるのではなく phi をベースにする方針

## phi に独自オーバーライドを足すときの流儀

- 同ディレクトリに `phi-custom.css` を作る
- 中で `:root { ... }` の代わりに `body { ... }` で phi の `--phi--*` 変数を上書きする
- 変数だけで足りない CSS は phi の後にロードされる形で書き足す
- `custom.css` 本体（phi）は触らない（更新で上書きされるため）

## 変更反映

CSS modifications の変更はタブリロードでは反映されない。**Vivaldi の再起動が必要**。

## Vivaldi UI クラス名（バージョン差あり、外したら DevTools で再確認）

DevTools 起動: `vivaldi://experiments` で開発者ツールを有効化 → `Ctrl+Shift+I`

- ピン留めタブの未読／通知バッジ: `.button-badge`
  - 例: `#tabs-container .tab-position.is-pinned .button-badge`
- タブストリップコンテナ: `#tabs-container .tab-strip`
- タブセル: `.tab-position`（ピン留め判定は `.is-pinned`）
- タブ本体: `.tab` / `.tab.pinned`
- ファビコン: `.favicon`
- タブタイトル: `.title`
