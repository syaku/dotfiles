# ナレッジの所在

規範・知識は、それが効くべき範囲に置く。ローカルに閉じる auto memory に行動規範を溜めない（環境間で同期されず、recalled memory は context 扱いで強制力も弱いため）。

## どの器に置くか

| 対象 | 置き場 |
|---|---|
| この環境固有の事実・ユーザの人物像/好み | auto memory（`~/.claude/projects/.../memory/`） |
| 全環境で常に守る行動規範 | `~/.claude/CLAUDE.md` または `~/.claude/rules/*.md`（paths なし） |
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

新しく規範を得たら、まず上の表でどの器かを判断して置く。
