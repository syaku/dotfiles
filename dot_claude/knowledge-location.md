規範・知識は、それが効くべき範囲に置く。新しく規範・知識・好み・運用ノウハウを永続化するときは、**どの器に置くかをまず判断する**。器の選択表・CLAUDE.md と rules の境界判定・rules の入場条件・paths glob の書き方・モデル世代での再ベースラインは **`/knowledge-placement` skill** が正本（永続化のタスク時にだけ要るため常時ロードに置かない）。

- 記憶は 3 層で運用する。**事象の短期記憶は session_memory**（SessionEnd hook の自動要約。書く操作は無い）、**長期の記録は vault**（`notes/obsidian/Life/`。議論ログ・作業レポート・人物像・環境の事実は `inbox/` に置き `/drain` で昇格）、**強制力を要する規範は rules**（証拠の逐語は `~/.claude/grounding/`）。recalled memory は context 扱いで強制力が弱いので規範は memory に置かない。
- **curated な auto memory（`claude-memory/` への手書き）は新規に書かない。** 手で選んで永続化する層は session_memory と vault が置き換えた。既存の `MEMORY.md` 索引は読むだけで、更新も追加もしない（2026-09-13）。

### 業務機密は同期される正本に書かない（常時厳守）

業務で得た機密（社内事情・人名・チケット番号・インシデント・面談内容など）を含む規範・知識は、chezmoi で全環境に同期される正本（source）へ流出させない。

- 機密を含む規範は `local-` prefix で `~/.claude/rules/local-*.md` に置く（`.chezmoiignore` で source 非同期、target を直接編集）。
- 機密を、同期される非 local ファイル（`~/.claude/CLAUDE.md`（および import される本節）・paths なし rules・`/knowledge-placement` skill 本体 など）に書かない。vault にも書かない（私用端末では Obsidian Sync 経由でクラウド同期されうるため）。業務機密は vault ではなく `local-*.md` へ。
- 機密を Artifact として公開しない。claude.ai にホストされる時点で外部に出ており、削除してもキャッシュや索引は残りうる。vault や業務資料を可視化するときは、機密を除いた内容だけを対象にする。
- 同テーマで `local-*.md` と同期側が衝突したら `local-*.md` を優先する（より具体的な層だから。自動優先ではなく運用上の取り決め）。
