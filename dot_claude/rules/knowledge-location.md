# ナレッジの所在（索引）

規範・知識は、それが効くべき範囲に置く。新しく規範・知識・好み・運用ノウハウを永続化するときは、**どの器に置くかをまず判断する**。

- 器の選択表（auto memory / paths なし rules / paths 付き rules / local-*.md / CLAUDE.md / skill）・paths glob の書き方・local 運用の詳細は **`/knowledge-placement` skill** を参照。
- ローカルに閉じる auto memory に行動規範を溜めない（同期されず、recalled memory は context 扱いで強制力が弱い）。memory は事実・人物像・タスク状態のみ。

## 業務機密は同期される正本に書かない（常時厳守）

業務で得た機密（社内事情・人名・チケット番号・インシデント・面談内容など）を含む規範・知識は、chezmoi で全環境に同期される正本（source）へ流出させない。

- 機密を含む規範は `local-` prefix で `~/.claude/rules/local-*.md` に置く（`.chezmoiignore` で source 非同期、target を直接編集）。
- 機密を、同期される非 local ファイル（`~/.claude/CLAUDE.md` / paths なし rules / この索引 / `/knowledge-placement` skill 本体 など）に書かない。
- 同テーマで `local-*.md` と同期側が衝突したら `local-*.md` を優先する（より具体的な層だから。自動優先ではなく運用上の取り決め）。
