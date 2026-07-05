規範・知識は、それが効くべき範囲に置く。新しく規範・知識・好み・運用ノウハウを永続化するときは、**どの器に置くかをまず判断する**。器の選択表・CLAUDE.md と rules の境界判定・rules の入場条件・paths glob の書き方・モデル世代での再ベースラインは **`/knowledge-placement` skill** が正本（永続化のタスク時にだけ要るため常時ロードに置かない）。

- auto memory に行動規範を溜めない（recalled memory は context 扱いで強制力が弱く、常時ロードの rules の方が強い）。memory は事実・人物像・タスク状態のみ。書く際の書き口は [[agent-behavior]] 「auto memory の書き口」節を参照。

### 業務機密は同期される正本に書かない（常時厳守）

業務で得た機密（社内事情・人名・チケット番号・インシデント・面談内容など）を含む規範・知識は、chezmoi で全環境に同期される正本（source）へ流出させない。

- 機密を含む規範は `local-` prefix で `~/.claude/rules/local-*.md` に置く（`.chezmoiignore` で source 非同期、target を直接編集）。
- 機密を、同期される非 local ファイル（`~/.claude/CLAUDE.md`（および import される本節）・paths なし rules・`/knowledge-placement` skill 本体 など）に書かない。auto memory も同様に書かない（私用端末では Obsidian Sync 経由でクラウド同期されうるため）。業務機密は memory ではなく `local-*.md` へ。
- 同テーマで `local-*.md` と同期側が衝突したら `local-*.md` を優先する（より具体的な層だから。自動優先ではなく運用上の取り決め）。
