# ナレッジの所在

規範・知識は、それが効くべき範囲に置く。ローカルに閉じる auto memory に行動規範を溜めない（環境間で同期されず、recalled memory は context 扱いで強制力も弱いため）。

## どの器に置くか

| 対象 | 置き場 |
|---|---|
| この環境固有の事実・ユーザの人物像/好み | auto memory（`~/.claude/projects/.../memory/`） |
| 全環境で常に守る行動規範 | `~/.claude/CLAUDE.md` または `~/.claude/rules/*.md`（paths なし） |
| この環境だけで効かせたい規範・運用知識（機密含む） | `~/.claude/rules/local-*.md`（`local-` prefix・chezmoi 非同期） |
| 特定プロジェクト全体の規約 | プロジェクト `./CLAUDE.md` |
| 特定ディレクトリでだけ効く知識 | そのディレクトリの `CLAUDE.md` |
| 特定の言語・ファイル種別・パスでだけ効く規範 | `.claude/rules/*.md` に `paths:` で glob 指定 |
| 多段手順・タスク時だけ要るもの | skill |

（各置き場が「いつ・どうロードされるか」は背景知識。別途技術ノートに記録。）

## CLAUDE.md と paths 付き rules の棲み分け

判断軸は「**全ファイル作業で要るか、特定の種別でだけ要るか**」。

- **常に効くべき** → CLAUDE.md（または paths なし rules）。
- **特定ファイルを触るときだけ効くべき** → `paths:` 付き rules に切り出し、常時ロードを避ける。
  - 例: `paths: ["**/*.rs"]`、`paths: ["**/*.test.*"]`、`paths: ["src/api/**/*"]`
  - フォルダ配下すべてを対象にするには `dir/**/*` と再帰 glob で書く（`dir/` や `dir/*` 直下のみでは配下全体にならない）。
- CLAUDE.md が 200 行に近づいたらトピック単位で rules に分割する。多段手順は rules でなく skill へ。

## 環境固有だが規範として強制したいもの

Claude Code にユーザーレベルの「.local」相当は無い（`CLAUDE.local.md` はプロジェクト限定）。OS/マシンで出し分けたい規範（例: Windows 限定の運用）は、chezmoi の `.tmpl` で条件分岐して `~/.claude/rules/<os>.md` を該当環境にだけ展開する。全環境に配った上で特定マシンで外すなら `claudeMdExcludes`（`settings.local.json`）を使う。

## 業務機密は同期される正本に書かない

業務で得た機密（社内事情・人名・チケット番号・インシデント・面談内容など）を含む規範・知識は、chezmoi で全環境に同期される正本（source）へ流出させない。情報漏洩対策であり、`local-` 運用の動機の一つ（もう一つは上表「この環境だけで効かせたい規範・運用知識」の保存で、機密でなくても環境固有なら local- でよい）。

- 機密を含む規範を rules 化するときは、ファイル名に `local-` prefix を付けて `~/.claude/rules/local-*.md` に置く。`.chezmoiignore` の `.claude/rules/local-*.md` 指定で source に取り込まれず、そのマシンに閉じる（編集は target を直接行う。source 編集は不要・不可）。
- 機密を含む内容を、同期される非 local ファイル（`~/.claude/CLAUDE.md` / paths なし rules / この `knowledge-location.md` 自身 / `verification.md` など）には書かない。書けばそれ自体が正本への浸食になる。
- auto memory はローカル前提だが行動規範はそこに溜めない（冒頭の方針どおり）。事実・人物像・タスク状態のみ残す。
- 確認: `chezmoi managed | grep local-` に出ないこと、`chezmoi add --dry-run <file>` で `warning: ignoring …` が出ることで chezmoi 非管理を検証できる。

## local-*.md（マシンローカル）を優先する

同テーマで `local-*.md` と同期側（`CLAUDE.md` / paths なし rules / この `knowledge-location.md`）の内容が衝突したら、`local-*.md` 側を優先する。そのマシンの事情に合わせて意図的に置かれた、より具体的な層だから。多くの local- ルールは同期側と衝突せず追加的に効くので、これは衝突時のタイブレーク。Claude Code が `local-` 命名を自動で優先するわけではなく、運用上の取り決めとしてここに明記している（マシンによっては該当ファイルが無く no-op）。

新しく規範を得たら、まず上の表でどの器かを判断して置く。機密を含むなら上節のとおり `local-` に隔離する。
