決まりや知識は、それが効くべき範囲に置く。新しく決まり、知識、好み、運用のやり方を残すときは、**まずどこに置くかを判断する**。置き場所の選び方、CLAUDE.md と rules の境界、rules に入れてよい条件、paths glob の書き方、モデルの世代が変わったときの見直しは **`/knowledge-placement` skill** が持つ（残す作業のときだけ要るので、毎回は読み込まない）。

- 記憶は 3 層で運用する。**出来事の短期の記憶は session_memory**（SessionEnd hook が自動で要約する。手で書く操作は無い）。**長期の記録は vault**（`notes/obsidian/Life/`。議論のログ、作業レポート、人物像、環境の事実は `inbox/` に置き、`/drain` で notes/ に移す）。**強制力が要る決まりは rules**（元になった失敗の記録は `~/.claude/grounding/` に原文のまま置く）。recalled memory は文脈として読まれるだけで強制力が弱いので、決まりは memory に置かない。
- **手で選んで `claude-memory/` に書く auto memory は新しく書かない。** 手で選んで残す層は session_memory と vault に置き換えた。既存の `MEMORY.md` 索引は読むだけで、更新も追加もしない（2026-09-13）。

### 業務機密は同期される元のファイルに書かない（常時厳守）

業務で得た機密（社内の事情、人名、チケット番号、インシデント、面談の内容など）を含む決まりや知識は、chezmoi で全環境に同期される元のファイル（source）に書かない。

- 機密を含む決まりは `local-` を頭に付けて `~/.claude/rules/local-*.md` に置く（`.chezmoiignore` で source に取り込まれない。target を直接編集する）。
- 機密を、同期される local 以外のファイル（`~/.claude/CLAUDE.md` とそこから読み込まれる本節、paths の無い rules、`/knowledge-placement` skill 本体など）に書かない。vault にも書かない（私用の端末では Obsidian Sync でクラウドに同期されうるため）。業務機密は vault ではなく `local-*.md` へ。
- 機密を Artifact として公開しない。claude.ai に置かれた時点で外に出ていて、削除してもキャッシュや索引は残りうる。vault や業務資料を図にするときは、機密を除いた内容だけを対象にする。
- 同じ話題で `local-*.md` と同期される側がぶつかったら `local-*.md` を優先する（より具体的な層だから。自動で優先されるのではなく、運用上の取り決め）。
