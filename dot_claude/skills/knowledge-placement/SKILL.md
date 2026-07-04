---
name: knowledge-placement
description: 新しく得た規範・知識・ユーザの人物像/好み・運用ノウハウを永続化する際、どの器（auto memory / paths なし rules / paths 付き rules / local-*.md / プロジェクト CLAUDE.md / skill）に置くかを判断するスキル。機密の隔離や paths glob の書き方も扱う。「これを覚えて」「ルールにして」「規範として残して」など永続化先の判断が要るときに参照する。
---

# knowledge-placement: ナレッジの所在を決める

規範・知識は、それが効くべき範囲に置く。auto memory に行動規範を溜めない（recalled memory は context 扱いで強制力が弱く、常時ロードの rules の方が強いため）。

## どの器に置くか

| 対象 | 置き場 |
|---|---|
| この環境固有の事実・ユーザの人物像/好み | auto memory（`~/.claude/projects/.../memory/`） |
| 全環境で常に守る行動規範 | `~/.claude/rules/*.md`（paths なし） |
| この環境だけで効かせたい規範・運用知識（機密含む） | `~/.claude/rules/local-*.md`（`local-` prefix・chezmoi 非同期） |
| 特定プロジェクト全体の規約 | プロジェクト `./CLAUDE.md` |
| 特定ディレクトリでだけ効く知識 | そのディレクトリの `CLAUDE.md` |
| 特定の言語・ファイル種別・パスでだけ効く規範 | `.claude/rules/*.md` に `paths:` で glob 指定 |
| 多段手順・タスク時だけ要るもの | skill |

（各置き場が「いつ・どうロードされるか」は背景知識。別途技術ノートに記録。）

## CLAUDE.md と rules の棲み分け

**規範・指示的な内容は rules に寄せ、CLAUDE.md は薄く保つ。** CLAUDE.md にはマシン固有の入口情報（ワークスペース構成、rules の運用ポリシー等）だけを置く。新しい行動規範は最初から `~/.claude/rules/*.md` に切り出す。

## paths 付き rules の書き方

特定ファイル種別だけで効かせる規範（前述の表）の `paths:` 指定:

- 例: `paths: ["**/*.rs"]`、`paths: ["**/*.test.*"]`、`paths: ["src/api/**/*"]`
- フォルダ配下すべてを対象にするには `dir/**/*` と再帰 glob で書く（`dir/` や `dir/*` 直下のみでは配下全体にならない）。
- 照合の実装挙動（Claude Code 2.1 系で確認済み）: rule の `paths` glob は、セッション中に Read/Edit したファイルの**絶対パス**（`\`→`/` 正規化済み）に対し picomatch で `{nocase:true, dot:true}` で照合される。`dot:true` なので `**` は `.config`/`.local`/`.claude` 等の隠しディレクトリを横断する。brace 展開（`**/*.{ts,py}`）も既定で有効。発火条件は「その glob にマッチするファイルを能動的に Read/Edit したとき」。

## 環境固有だが規範として強制したいもの

Claude Code にユーザーレベルの「.local」相当は無い（`CLAUDE.local.md` はプロジェクト限定）。OS/マシンで出し分けたい規範（例: Windows 限定の運用）は、chezmoi の `.tmpl` で条件分岐して `~/.claude/rules/<os>.md` を該当環境にだけ展開する。全環境に配った上で特定マシンで外すなら `claudeMdExcludes`（`settings.local.json`）を使う。

## 業務機密は同期される正本に書かない

業務で得た機密（社内事情・人名・チケット番号・インシデント・面談内容など）を含む規範・知識は、chezmoi で全環境に同期される正本（source）へ流出させない。情報漏洩対策であり、`local-` 運用の動機の一つ（もう一つは上表「この環境だけで効かせたい規範・運用知識」の保存で、機密でなくても環境固有なら local- でよい）。

- 機密を含む規範を rules 化するときは、ファイル名に `local-` prefix を付けて `~/.claude/rules/local-*.md` に置く。`.chezmoiignore` の `.claude/rules/local-*.md` 指定で source に取り込まれず、そのマシンに閉じる（編集は target を直接行う。source 編集は不要・不可）。
- 機密を含む内容を、同期される非 local ファイル（`~/.claude/CLAUDE.md`（および @import される `~/.claude/knowledge-location.md`）/ paths なし rules / この skill 自身 など）には書かない。書けばそれ自体が正本への浸食になる。
- auto memory にも機密を書かない（私用端末では Obsidian Sync 経由でクラウド同期されうるため）。業務機密は memory ではなく `local-*.md` へ。行動規範はそもそも memory に溜めない（冒頭の方針どおり）。memory は事実・人物像・タスク状態のみ残す。
- 確認: `chezmoi managed | grep local-` に出ないこと、`chezmoi add --dry-run <file>` で `warning: ignoring …` が出ることで chezmoi 非管理を検証できる。

## local-*.md（マシンローカル）を優先する

同テーマで `local-*.md` と同期側（`CLAUDE.md`（および @import される `knowledge-location.md`）/ paths なし rules）の内容が衝突したら、`local-*.md` 側を優先する。そのマシンの事情に合わせて意図的に置かれた、より具体的な層だから。多くの local- ルールは同期側と衝突せず追加的に効くので、これは衝突時のタイブレーク。Claude Code が `local-` 命名を自動で優先するわけではなく、運用上の取り決めとしてここに明記している（マシンによっては該当ファイルが無く no-op）。

新しく規範を得たら、まず上の表でどの器かを判断して置く。機密を含むなら上節のとおり `local-` に隔離する。
